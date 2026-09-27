import { randomUUID } from 'node:crypto';
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { Clock } from '../common/clock';
import {
  RUN_COMPLETED,
  type RunCompletedPayload,
  SESSION_TEXT_REQUESTED,
  type SessionTextRequestItem,
} from '../common/events';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EngineError } from '../engine/errors';
import type { CatalogEntry } from '../engine/generator';
import { generateShift } from '../engine/generator';
import { commitOf, createRng, newSeed, type Rng } from '../engine/rng';
import type { ScenarioGraph } from '../engine/schema';
import { createState } from '../engine/step';
import type { EngineState, RunSummary, ShiftPlan, TextVariant } from '../engine/types';
import { view } from '../engine/view';
import { ActorType, type GameSession, type Prisma } from '../generated/prisma/client';
import type { LlmJobData } from '../llm/llm.constants';
import { VariantPoolService } from '../llm/variant-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { isUniqueViolation } from '../users/unique-violation';
import {
  addedFlags,
  FLAG_SEQ_JUMP,
  FLAG_TICKET_REUSED,
  isSuspicious,
  mergeFlags,
  reactionFlag,
} from './anti-cheat';
import { computeNext } from './compute-next';
import type { DecisionView, GameEventsBody, OpenedSession, RunReport, VerifyResult } from './dto';
import { weakest } from './focus';
import { SESSION_TTL_MS } from './game-cookie';
import {
  fromEngine,
  notFound,
  runMissing,
  seqMismatch,
  sessionClosed,
  sessionNotActive,
  ticketReused,
  wrongTransport,
} from './http-errors';
import { gameLaunchUrl } from './platform-url';
import { decisionBody, readReplay } from './present';
import { reportToSummary } from './report-map';
import { loadRoutesFile } from './routes-file';
import { decryptSeed, encryptSeed } from './seed-box';
import { lockUserSessions } from './session-lock';
import {
  attachShown,
  currentGraph,
  deadlineFor,
  isRecord,
  isUuid,
  readPlan,
  splitState,
  toJson,
  toPublicPlan,
} from './state-json';
import {
  buildTextPlan,
  livePinTarget,
  llmMode,
  orderRng,
  payloadVariant,
  readTextPlan,
  selectedVariantIds,
  textPlanKey,
} from './text-plan';
import type { TicketClaims } from './ticket.service';
import { TicketService } from './ticket.service';

type OpenBody = {
  transport: 'WS';
  carClass?: ShiftPlan['carClass'];
};

type SessionActor = {
  type: ActorType;
  id: string | null;
  ip: string | null;
};

type DecideCommand = {
  sessionId: string;
  seq: number;
  choiceId: string;
  clientTs?: number;
  ownerId: string | null;
  transport: 'REST' | 'WS';
  actor: SessionActor;
};

type Draft = {
  seedEnc: string;
  seedCommit: string;
  plan: ShiftPlan;
  state: ReturnType<typeof attachShown>;
  deadline: Date | null;
  titles: string[];
  assignmentId: string | null;
  now: Date;
  textPlan: Record<string, string | null> | null;
  live: SessionTextRequestItem[];
};

type StoredRun = {
  runId: string;
  suspicious: boolean;
  summary: RunSummary | null;
};

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly routes = loadRoutesFile();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScenariosService) private readonly scenarios: ScenariosService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TicketService) private readonly tickets: TicketService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(VariantPoolService) private readonly pool: VariantPoolService,
  ) {}

  async open(user: AuthUser, body: OpenBody, ip: string | null): Promise<OpenedSession> {
    const now = this.clock.now();
    const draft = await this.prepare(user.id, body, now);
    const saved = await this.prisma.$transaction((tx) =>
      this.persistOpen(tx, user.id, body.transport, draft, ip),
    );
    await this.pool.enqueueRefills(saved.refills);
    if (saved.kind === 'existing') {
      return this.resume(saved.row, ip);
    }
    if (draft.live.length > 0) {
      await this.events.emitAsync(SESSION_TEXT_REQUESTED, {
        sessionId: saved.row.id,
        items: draft.live,
      });
    }
    const ticket = await this.tickets.sign(user.id, saved.row.id);
    return this.opened(saved.row, ticket, draft.plan, draft.titles);
  }

  async decide(command: DecideCommand): Promise<DecisionView> {
    const session = await this.sessionFor(command);
    if (session.transport !== command.transport) {
      throw wrongTransport();
    }
    const replay = await this.findReplay(session.id, command.seq, command.choiceId);
    if (replay) {
      if (replay.finished) {
        await this.ensureRecorded(session.id);
      }
      return replay;
    }
    if (command.seq !== session.seq) {
      await this.noteFlag(session, FLAG_SEQ_JUMP, command.actor);
      throw seqMismatch();
    }
    if (!isPlayable(session.status)) {
      throw sessionClosed();
    }
    const now = this.clock.now();
    const plan = readPlan(session.plan);
    const graphs = await this.graphsFor(plan);
    const split = splitState(session.state);
    const graph = currentGraph(split.state, graphs);
    const currentText = await this.presentation(session, split.state, graph);
    const next = this.safeNext({
      state: split.state,
      shownAt: split.shownAt,
      plan,
      graphs,
      choiceId: command.choiceId,
      deadline: session.nodeDeadlineAt,
      now,
      flags: session.flags,
      textVariant: currentText.variant,
    });
    const nextGraph = currentGraph(next.state, graphs);
    const nextText = await this.presentation(session, next.state, nextGraph);
    next.nodeView = view(next.state, nextGraph, 0, {
      textVariant: nextText.variant,
      rng: nextText.rng,
    });
    const status = next.finished ? 'COMPLETED' : 'ACTIVE';
    const response = decisionBody(status, next);
    const won = await this.persistStep(session, command, next, response, now);
    if (!won) {
      return this.afterRace(command);
    }
    return response;
  }

  async abort(
    userId: string,
    sessionId: string,
    ip: string | null,
  ): Promise<{ status: 'ABORTED' }> {
    const session = await this.owned(userId, sessionId);
    const now = this.clock.now();
    const updated = await this.prisma.gameSession.updateMany({
      where: { id: session.id, userId, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: 'ABORTED', finishedAt: now },
    });
    if (updated.count !== 1) {
      throw sessionClosed();
    }
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: userId,
      action: 'session.aborted',
      target: session.id,
      ip,
    });
    await this.publish(session.id, 'abort', now);
    await this.releaseVariants(session.id);
    return { status: 'ABORTED' };
  }

  async acceptEvents(
    sessionId: string,
    body: GameEventsBody,
  ): Promise<{ accepted: number; duplicates: number }> {
    await this.mustSession(sessionId);
    let accepted = 0;
    let duplicates = 0;
    for (const event of body.events) {
      const inserted = await this.insertTelemetry(sessionId, event);
      if (inserted) {
        accepted += 1;
      } else {
        duplicates += 1;
      }
    }
    return { accepted, duplicates };
  }

  async acceptReport(sessionId: string, report: RunReport): Promise<{ runId: string }> {
    const session = await this.mustSession(sessionId);
    if (session.status === 'COMPLETED') {
      return { runId: await this.replayRun(sessionId) };
    }
    if (session.status !== 'ACTIVE') {
      throw sessionNotActive();
    }
    const summary = reportToSummary(report);
    const fast = reactionFlag(summary.decisions.map((decision) => decision.reactionMs));
    const flags = mergeFlags(session.flags, fast ? [fast] : []);
    const suspicious = isSuspicious(flags);
    const runId = randomUUID();
    const now = this.clock.now();
    const won = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          finishedAt: now,
          flags,
          result: toJson({ runId, suspicious, summary }),
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await tx.auditLog.create({
        data: {
          actorType: ActorType.GAME_SERVER,
          action: 'session.completed',
          target: session.id,
          meta: toJson({ runId, suspicious }),
        },
      });
      await writeNewFlags(tx, session, flags, { type: ActorType.GAME_SERVER, id: null, ip: null });
      return true;
    });
    if (!won) {
      return { runId: await this.replayRun(sessionId) };
    }
    await this.emitCompleted({
      runId,
      userId: session.userId,
      sessionId: session.id,
      summary,
      suspicious,
    });
    return { runId };
  }

  async verifyTicket(token: string): Promise<VerifyResult> {
    const claims = await this.tickets.read(token);
    const fresh = await this.tickets.consume(claims.jti);
    if (!fresh) {
      await this.flagReuse(claims);
      throw ticketReused();
    }
    const session = isUuid(claims.sid)
      ? await this.prisma.gameSession.findUnique({ where: { id: claims.sid } })
      : null;
    if (!session || session.userId !== claims.sub) {
      throw notFound();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { callsign: true },
    });
    if (!user) {
      throw notFound();
    }
    const status = await this.activatePending(session, this.clock.now());
    return {
      userId: session.userId,
      callsign: user.callsign,
      sessionId: session.id,
      plan: readPlan(session.plan),
      status,
    };
  }

  async expireDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.gameSession.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE'] }, expiresAt: { lt: now } },
      select: { id: true },
    });
    let expired = 0;
    for (const row of due) {
      const did = await this.expireOne(row.id, now);
      if (did) {
        expired += 1;
      }
    }
    return expired;
  }

  private async prepare(userId: string, body: OpenBody, now: Date): Promise<Draft> {
    const [entries, focus, assignment] = await Promise.all([
      this.catalogEntries(),
      this.focusOf(userId),
      this.plannedAssignment(userId),
    ]);
    const seed = newSeed();
    const plan = generateShift(
      createRng(seed),
      entries,
      {
        carClass: body.carClass ?? assignment?.carClass,
        focus,
        assigned: assignment?.scenarioIds ?? [],
      },
      this.routes,
    );
    const graphs = await this.graphsFor(plan);
    const state = this.safeState(plan, graphs);
    const graph = currentGraph(state, graphs);
    const node = graph.nodes[state.nodeId];
    if (!node) {
      throw fromEngine(new EngineError('NODE_MISSING'));
    }
    const assembly = await buildTextPlan(createRng(seed), plan, graphs, async (query, fork) => {
      const chosen = await this.pool.pick(
        query.scenarioId,
        query.version,
        query.nodeId,
        fork,
        query.persona.length > 0 ? { persona: query.persona } : undefined,
      );
      return chosen?.id ?? null;
    });
    return {
      seedEnc: encryptSeed(seed, this.config.seedEncKey),
      seedCommit: commitOf(seed),
      plan,
      state: attachShown(state, now),
      deadline: deadlineFor(node, now),
      titles: await this.titlesFor(plan),
      assignmentId: assignment?.id ?? null,
      now,
      textPlan: assembly.textPlan,
      live: assembly.live,
    };
  }

  private safeState(plan: ShiftPlan, graphs: readonly ScenarioGraph[]) {
    try {
      return createState(plan, graphs);
    } catch (error) {
      if (error instanceof EngineError) {
        throw fromEngine(error);
      }
      throw error;
    }
  }

  private safeNext(input: Parameters<typeof computeNext>[0]) {
    try {
      return computeNext(input);
    } catch (error) {
      if (error instanceof EngineError) {
        throw fromEngine(error);
      }
      throw error;
    }
  }

  private async persistOpen(
    tx: Prisma.TransactionClient,
    userId: string,
    transport: OpenBody['transport'],
    draft: Draft,
    ip: string | null,
  ): Promise<{ kind: 'existing' | 'created'; row: GameSession; refills: LlmJobData[] }> {
    await lockUserSessions(tx, userId);
    const existing = await tx.gameSession.findFirst({
      where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { kind: 'existing', row: existing, refills: [] };
    }
    const shiftId = await claimShift(tx, userId, draft.assignmentId);
    const row = await tx.gameSession.create({
      data: {
        userId,
        shiftId,
        status: 'PENDING',
        transport,
        plan: toJson(draft.plan),
        ...(draft.textPlan ? { textPlan: toJson(draft.textPlan) } : {}),
        seedCommit: draft.seedCommit,
        seedEnc: draft.seedEnc,
        state: toJson(draft.state),
        seq: draft.state.seq,
        nodeDeadlineAt: draft.deadline,
        startedAt: null,
        expiresAt: new Date(draft.now.getTime() + SESSION_TTL_MS),
        flags: [],
      },
    });
    const refills = draft.textPlan
      ? await this.pool.markUsed(selectedVariantIds(draft.textPlan), tx)
      : [];
    await tx.auditLog.create({
      data: {
        actorType: ActorType.USER,
        actorId: userId,
        action: 'session.opened',
        target: row.id,
        ip,
        meta: toJson({ transport }),
      },
    });
    return { kind: 'created', row, refills };
  }

  private async resume(row: GameSession, ip: string | null): Promise<OpenedSession> {
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: row.userId,
      action: 'session.resumed',
      target: row.id,
      ip,
    });
    const plan = readPlan(row.plan);
    const ticket = await this.tickets.sign(row.userId, row.id);
    return this.opened(row, ticket, plan, await this.titlesFor(plan));
  }

  private opened(
    row: GameSession,
    ticket: string,
    plan: ShiftPlan,
    titles: readonly string[],
  ): OpenedSession {
    return {
      sessionId: row.id,
      ticket,
      wsUrl: this.config.publicGameWsUrl,
      launchUrl: gameLaunchUrl(this.config.publicGameUrl, ticket),
      seedCommit: row.seedCommit,
      plan: toPublicPlan(plan, titles),
    };
  }

  private async persistStep(
    session: GameSession,
    command: DecideCommand,
    next: ReturnType<typeof computeNext>,
    response: DecisionView,
    now: Date,
  ): Promise<boolean> {
    const suspicious = isSuspicious(next.flags);
    const runId = next.finished ? randomUUID() : null;
    const summary = next.summary;
    const won = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameSession.updateMany({
        where: { id: session.id, seq: session.seq, status: { in: ['PENDING', 'ACTIVE'] } },
        data: {
          status: next.finished ? 'COMPLETED' : 'ACTIVE',
          seq: next.seq,
          state: toJson(next.stored),
          nodeDeadlineAt: next.deadline,
          flags: next.flags,
          startedAt: session.startedAt ?? now,
          finishedAt: next.finished ? now : null,
          ...(runId && summary ? { result: toJson({ runId, suspicious, summary }) } : {}),
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await tx.gameEvent.create({
        data: {
          sessionId: session.id,
          seq: command.seq,
          type: 'decision',
          payload: toJson({ choiceId: command.choiceId, applied: next.applied, response }),
          clientAt: command.clientTs === undefined ? null : new Date(command.clientTs),
        },
      });
      await writeNewFlags(tx, session, next.flags, command.actor);
      if (runId && summary) {
        await tx.auditLog.create({
          data: {
            actorType: command.actor.type,
            actorId: command.actor.id,
            action: 'session.completed',
            target: session.id,
            ip: command.actor.ip,
            meta: toJson({ runId, suspicious }),
          },
        });
      }
      return true;
    });
    if (won && runId && summary) {
      await this.emitCompleted({
        runId,
        userId: session.userId,
        sessionId: session.id,
        summary,
        suspicious,
      });
    }
    return won;
  }

  private async afterRace(command: DecideCommand): Promise<DecisionView> {
    const replay = await this.findReplay(command.sessionId, command.seq, command.choiceId);
    if (replay) {
      if (replay.finished) {
        await this.ensureRecorded(command.sessionId);
      }
      return replay;
    }
    const session = await this.mustSession(command.sessionId);
    if (!isPlayable(session.status)) {
      throw sessionClosed();
    }
    throw seqMismatch();
  }

  private async findReplay(
    sessionId: string,
    seq: number,
    choiceId: string,
  ): Promise<DecisionView | null> {
    const event = await this.prisma.gameEvent.findUnique({
      where: { sessionId_seq: { sessionId, seq } },
    });
    if (!event) {
      return null;
    }
    if (event.type !== 'decision') {
      throw seqMismatch();
    }
    const response = readReplay(event.payload, choiceId);
    if (!response) {
      throw seqMismatch();
    }
    return response;
  }

  /**
   * До показа живого узла с пустым слотом закрепляем вариант этой сессии.
   * Без варианта rng не передаём: порядок выборов остаётся авторским.
   */
  private async presentation(
    session: GameSession,
    state: EngineState,
    graph: ScenarioGraph,
  ): Promise<{ variant?: TextVariant; rng?: Rng }> {
    if (session.textPlan == null) {
      return {};
    }
    const row = await this.prisma.gameSession.findUnique({
      where: { id: session.id },
      select: { textPlan: true, seedEnc: true, plan: true },
    });
    if (!row) {
      return {};
    }
    let stored = readTextPlan(row.textPlan);
    const key = textPlanKey(state.scenarioId, state.nodeId);
    const mode = llmMode(graph);
    if (stored && livePinTarget(stored, key, mode)) {
      const shift = readPlan(row.plan);
      const planned = shift.scenarios.find((item) => item.scenarioId === state.scenarioId);
      if (planned) {
        const pinned = await this.pool.bindLive({
          sessionId: session.id,
          scenarioId: state.scenarioId,
          version: planned.version,
          nodeId: state.nodeId,
        });
        if (pinned) {
          stored = pinned;
        }
      }
    }
    const variantId = stored?.nodes[key];
    const variant = await this.loadVariant(typeof variantId === 'string' ? variantId : null);
    if (!variant) {
      return {};
    }
    const seed = this.decrypt(row.seedEnc);
    return {
      variant,
      rng: orderRng(createRng(seed), state.scenarioId, state.nodeId, state.seq),
    };
  }

  private async loadVariant(id: string | null): Promise<TextVariant | undefined> {
    if (id === null) {
      return undefined;
    }
    const row = await this.prisma.scenarioTextVariant.findUnique({
      where: { id },
      select: { payload: true },
    });
    if (!row) {
      return undefined;
    }
    return payloadVariant(row.payload);
  }

  flagTicketReuse(claims: TicketClaims): Promise<void> {
    return this.flagReuse(claims);
  }

  activatePendingSession(session: GameSession, now: Date): Promise<GameSession['status']> {
    return this.activatePending(session, now);
  }

  private async activatePending(session: GameSession, now: Date): Promise<GameSession['status']> {
    if (session.status !== 'PENDING') {
      return session.status;
    }
    await this.prisma.gameSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: { status: 'ACTIVE', startedAt: session.startedAt ?? now },
    });
    return 'ACTIVE';
  }

  private async noteFlag(session: GameSession, flag: string, actor: SessionActor): Promise<void> {
    if (!session.flags.includes(flag)) {
      await this.prisma.gameSession.update({
        where: { id: session.id },
        data: { flags: mergeFlags(session.flags, [flag]) },
      });
    }
    await this.audit.log({
      actorType: actor.type,
      actorId: actor.id,
      action: `anticheat.${flag}`,
      target: session.id,
      ip: actor.ip,
      meta: toJson({ flag }),
    });
  }

  private async flagReuse(claims: TicketClaims): Promise<void> {
    if (isUuid(claims.sid)) {
      const session = await this.prisma.gameSession.findUnique({ where: { id: claims.sid } });
      if (session) {
        await this.noteFlag(session, FLAG_TICKET_REUSED, {
          type: ActorType.GAME_SERVER,
          id: null,
          ip: null,
        });
        return;
      }
    }
    await this.audit.log({
      actorType: ActorType.GAME_SERVER,
      action: 'anticheat.ticket-reused',
      target: claims.sid,
      meta: toJson({ flag: FLAG_TICKET_REUSED, userId: claims.sub }),
    });
  }

  private async ensureRecorded(sessionId: string): Promise<void> {
    const existing = await this.prisma.run.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    const stored = await this.readStoredRun(sessionId);
    if (!stored?.summary) {
      return;
    }
    const session = await this.mustSession(sessionId);
    await this.emitCompleted({
      runId: stored.runId,
      userId: session.userId,
      sessionId,
      summary: stored.summary,
      suspicious: stored.suspicious,
    });
  }

  private async replayRun(sessionId: string): Promise<string> {
    const stored = await this.readStoredRun(sessionId);
    if (!stored) {
      throw runMissing();
    }
    await this.ensureRecorded(sessionId);
    return stored.runId;
  }

  private async readStoredRun(sessionId: string): Promise<StoredRun | null> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { result: true },
    });
    const stored = readStoredResult(session?.result);
    if (stored) {
      return stored;
    }
    const run = await this.prisma.run.findUnique({
      where: { sessionId },
      select: { id: true, suspicious: true },
    });
    if (!run) {
      return null;
    }
    return { runId: run.id, suspicious: run.suspicious, summary: null };
  }

  private async emitCompleted(event: RunCompletedPayload): Promise<void> {
    await this.events.emitAsync(RUN_COMPLETED, event);
  }

  private async expireOne(id: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.gameSession.updateMany({
      where: { id, status: { in: ['PENDING', 'ACTIVE'] }, expiresAt: { lt: now } },
      data: { status: 'EXPIRED', finishedAt: now },
    });
    if (updated.count !== 1) {
      return false;
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'session.expired',
      target: id,
    });
    await this.publish(id, 'expire', now);
    await this.releaseVariants(id);
    return true;
  }

  private async releaseVariants(sessionId: string): Promise<void> {
    try {
      await this.pool.releaseSession(sessionId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`не отпустить варианты сессии ${sessionId}: ${text}`);
    }
  }

  private async publish(sessionId: string, type: 'abort' | 'expire', at: Date): Promise<void> {
    try {
      await this.redis.publish(
        `vsm:game:${sessionId}`,
        JSON.stringify({ type, sessionId, at: at.toISOString() }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Не опубликовать vsm:game:${sessionId}: ${message}`);
    }
  }

  private async insertTelemetry(
    sessionId: string,
    event: GameEventsBody['events'][number],
  ): Promise<boolean> {
    try {
      await this.prisma.gameTelemetry.create({
        data: {
          sessionId,
          seq: event.seq,
          type: event.type,
          payload: toJson(event.payload),
          clientAt: event.clientAt ? new Date(event.clientAt) : null,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private async catalogEntries(): Promise<CatalogEntry[]> {
    const items = await this.scenarios.getCatalog();
    const entries: CatalogEntry[] = [];
    for (const item of items) {
      const stored = await this.scenarios.getVersion(item.id, item.version);
      entries.push({
        id: item.id,
        version: item.version,
        carClasses: item.carClasses,
        competencies: item.competencies,
        difficulty: item.difficulty,
        stage: item.stage,
        params: stored.graph.params,
      });
    }
    return entries;
  }

  private async graphsFor(plan: ShiftPlan): Promise<ScenarioGraph[]> {
    const graphs: ScenarioGraph[] = [];
    for (const item of plan.scenarios) {
      const stored = await this.scenarios.getVersion(item.scenarioId, item.version);
      graphs.push(stored.graph);
    }
    return graphs;
  }

  private async titlesFor(plan: ShiftPlan): Promise<string[]> {
    const titles: string[] = [];
    for (const item of plan.scenarios) {
      const row = await this.prisma.scenario.findUnique({
        where: { id: item.scenarioId },
        select: { title: true },
      });
      titles.push(row?.title ?? item.scenarioId);
    }
    return titles;
  }

  private async focusOf(userId: string) {
    const rows = await this.prisma.competencyScore.findMany({
      where: { userId },
      select: { competency: true, value: true },
    });
    return weakest(rows, 2);
  }

  private plannedAssignment(userId: string) {
    return this.prisma.shiftAssignment.findFirst({
      where: { userId, status: 'PLANNED' },
      orderBy: [{ departureAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async sessionFor(command: DecideCommand): Promise<GameSession> {
    if (command.ownerId) {
      return this.owned(command.ownerId, command.sessionId);
    }
    return this.mustSession(command.sessionId);
  }

  private async owned(userId: string, sessionId: string): Promise<GameSession> {
    if (!isUuid(sessionId)) {
      throw notFound();
    }
    const session = await this.prisma.gameSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw notFound();
    }
    return session;
  }

  private async mustSession(sessionId: string): Promise<GameSession> {
    if (!isUuid(sessionId)) {
      throw notFound();
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw notFound();
    }
    return session;
  }

  private decrypt(packed: string): Buffer {
    try {
      return decryptSeed(packed, this.config.seedEncKey);
    } catch {
      throw new InternalServerErrorException({ message: 'Seed не читается', code: 'SEED_BOX' });
    }
  }
}

function isPlayable(status: GameSession['status']): boolean {
  return status === 'PENDING' || status === 'ACTIVE';
}

async function claimShift(
  tx: Prisma.TransactionClient,
  userId: string,
  assignmentId: string | null,
): Promise<string | null> {
  if (!assignmentId) {
    return null;
  }
  const updated = await tx.shiftAssignment.updateMany({
    where: { id: assignmentId, userId, status: 'PLANNED' },
    data: { status: 'STARTED' },
  });
  return updated.count === 1 ? assignmentId : null;
}

async function writeNewFlags(
  tx: Prisma.TransactionClient,
  session: GameSession,
  flags: readonly string[],
  actor: SessionActor,
): Promise<void> {
  for (const flag of addedFlags(session.flags, flags)) {
    await tx.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        action: `anticheat.${flag}`,
        target: session.id,
        ip: actor.ip,
        meta: toJson({ flag }),
      },
    });
  }
}

function readStoredResult(raw: unknown): StoredRun | null {
  if (!isRecord(raw) || typeof raw.runId !== 'string') {
    return null;
  }
  return {
    runId: raw.runId,
    suspicious: raw.suspicious === true,
    summary: isSummary(raw.summary) ? raw.summary : null,
  };
}

function isSummary(value: unknown): value is RunSummary {
  return isRecord(value) && typeof value.outcome === 'string' && Array.isArray(value.decisions);
}
