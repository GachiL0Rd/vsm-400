import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';
import type {
  ActionView, ClientMessage, DialogueView, NpcView, ObservableSnapshot,
  PoiView, SnapshotPatch, TaskView,
} from '../src/client/protocol.ts';
import { PROTOCOL_VERSION } from '../src/client/protocol.ts';

type Scenario = 'pressure' | 'fire' | 'service' | 'conflict';
const SCENARIOS: Scenario[] = ['pressure', 'fire', 'service', 'conflict'];
const action = (id: string, kind: ActionView['kind'], label: string, enabled = true): ActionView => ({
  id, kind, label, enabled,
});
const blockedAction = (id: string, kind: ActionView['kind'], label: string, reason: string): ActionView => ({
  id, kind, label, enabled: false, disabledReason: reason,
});

function initialNpcs(): NpcView[] {
  return [
    { id: 'p1', label: 'Алексей', zoneId: 'platform', anchorId: 'platform-1',
      intent: { kind: 'wait', targetId: 'platform-1', sequence: 1 }, actions: [action('talk', 'talk', 'Поговорить')] },
    { id: 'p2', label: 'Мария', zoneId: 'cabin', anchorId: 'seat-2',
      intent: { kind: 'sit', targetId: 'seat-2', sequence: 1 }, actions: [action('talk', 'talk', 'Поговорить')] },
    { id: 'p3', label: 'Илья', zoneId: 'cabin', anchorId: 'seat-3',
      intent: { kind: 'sit', targetId: 'seat-3', sequence: 1 }, actions: [action('talk', 'talk', 'Поговорить')] },
    { id: 'p4', label: 'Нина', zoneId: 'service', anchorId: 'service',
      intent: { kind: 'wait', targetId: 'service', sequence: 1 }, actions: [action('talk', 'talk', 'Поговорить')] },
  ];
}

function initialPoi(): PoiView[] {
  return [
    { id: 'door', kind: 'door', label: 'Дверь вагона', zoneId: 'vestibule', actions: [] },
    { id: 'seat-1', kind: 'seat', label: 'Место 18A', zoneId: 'cabin', actions: [] },
    { id: 'seat-2', kind: 'seat', label: 'Место 18B', zoneId: 'cabin', actions: [] },
    { id: 'seat-3', kind: 'seat', label: 'Место 19A', zoneId: 'cabin', actions: [] },
    { id: 'panel', kind: 'panel', label: 'Панель давления', zoneId: 'cabin',
      actions: [action('quick', 'inspect', 'Быстрый осмотр'), action('full', 'inspect', 'Подробный осмотр')] },
    { id: 'extinguisher', kind: 'extinguisher', label: 'Огнетушитель', zoneId: 'service',
      actions: [action('take', 'take-item', 'Взять огнетушитель')] },
    { id: 'service', kind: 'service', label: 'Сервисная зона', zoneId: 'service', actions: [] },
    { id: 'toilet', kind: 'toilet', label: 'Туалет', zoneId: 'service', actions: [] },
  ];
}

function createSnapshot(sessionId: string, scenario: Scenario): ObservableSnapshot {
  return {
    sessionId, revision: 1, simulationTime: 0, phase: 'boarding', playerZone: 'platform',
    message: `Тестовая смена: ${scenario}. Подойдите к вагону и следите за признаками.`,
    poi: initialPoi(), npcs: initialNpcs(),
    cues: [{ id: 'boarding-documents', kind: 'call', text: 'Алексей предъявил билет и удостоверение.', sourceId: 'p1' }],
    tasks: [], dialogue: null,
    item: 'stored', metrics: { safety: 100, satisfaction: 100 }, debrief: null,
    controls: { speed: 1 },
  };
}

function isScenario(value: unknown): value is Scenario {
  return typeof value === 'string' && SCENARIOS.includes(value as Scenario);
}

function dialogueFor(npcId: string, scenario: Scenario, clarified: boolean): DialogueView {
  if (npcId === 'p1') {
    return {
      id: 'documents', npcId, title: 'Посадка · документы', level: 1,
      lines: ['— Добрый день, вот билет и удостоверение.'],
      document: { fullName: 'Алексей Воронов', number: 'ТЕСТ 001', birthDate: '14.02.1992' },
      ticket: { fullName: 'Алексей Воронов', train: 'ВСМ 001', carriage: '04', seat: '18A' },
      options: [{ id: 'admit', label: 'Сверить и допустить', enabled: true },
        { id: 'reject', label: 'Отказать в посадке', enabled: true }],
    };
  }
  if (scenario === 'pressure' && npcId === 'p2') {
    return {
      id: 'pressure-complaint', npcId, title: 'Самочувствие пассажира', level: clarified ? 2 : 1,
      lines: [clarified ? '— Заложило уши, и справа слышен свист.' : '— Мне некомфортно в вагоне.'],
      options: clarified
        ? [{ id: 'check-panel', label: 'Проверить панель', enabled: true },
            { id: 'promise', label: 'Вернуться после проверки', enabled: true }]
        : [{ id: 'clarify', label: 'Уточнить симптомы', enabled: true },
            { id: 'dismiss', label: 'Не обращать внимания', enabled: true }],
    };
  }
  if (scenario === 'service' && npcId === 'p2') {
    return {
      id: 'dirty-seat', npcId, title: 'Заявка · грязное место', level: clarified ? 2 : 1,
      lines: [clarified ? '— На сиденье пятно, прошу помочь до отправления.' : '— Моё место грязное.'],
      options: clarified
        ? [{ id: 'promise-service', label: 'Проверить место и помочь', enabled: true },
            { id: 'dismiss', label: 'Отложить без объяснения', enabled: true }]
        : [{ id: 'clarify', label: 'Уточнить проблему', enabled: true },
            { id: 'dismiss', label: 'Проигнорировать', enabled: true }],
    };
  }
  if (scenario === 'conflict' && npcId === 'p3') {
    return {
      id: 'passenger-conflict', npcId, title: 'Спор пассажиров', level: clarified ? 2 : 1,
      lines: [clarified ? '— Мы спорим из-за места. У обоих есть билеты.' : '— У нас спор с другим пассажиром!'],
      options: clarified
        ? [{ id: 'check-tickets', label: 'Спокойно сверить билеты', enabled: true },
            { id: 'dismiss', label: 'Оставить спор без решения', enabled: true }]
        : [{ id: 'clarify', label: 'Выслушать обстоятельства', enabled: true },
            { id: 'dismiss', label: 'Прервать разговор', enabled: true }],
    };
  }
  return { id: 'smalltalk', npcId, title: 'Разговор', level: 1,
    lines: ['— Добрый день. Спасибо за внимание.'], options: [] };
}

class DemoSession {
  readonly clients = new Set<WebSocket>();
  state: ObservableSnapshot;
  private seen = new Set<string>();
  private clarified = new Set<string>();
  private signShown = false;
  private fireSevere = false;
  private reported = false;
  private resolved = false;
  private serviceResponse: 'none' | 'assured' | 'dismissed' = 'none';
  private firstSignTime = 0;
  private resolutionTime: number | null = null;
  private lastTick = Date.now();

  constructor(readonly id: string, private scenario: Scenario) {
    this.state = createSnapshot(id, scenario);
  }

  attach(socket: WebSocket): void {
    this.clients.add(socket);
    this.snapshot(socket);
    socket.on('close', () => this.clients.delete(socket));
  }

  snapshot(socket: WebSocket): void {
    this.send(socket, { type: 'snapshot', protocolVersion: PROTOCOL_VERSION, state: this.state });
  }

  tick(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 1);
    this.lastTick = now;
    if (this.clients.size === 0 || this.state.phase === 'finished' || this.state.controls?.speed === 0) return;
    const time = this.state.simulationTime + dt * (this.state.controls?.speed ?? 1);
    const change: SnapshotPatch = { simulationTime: time };
    if (time >= 5 && this.state.phase === 'boarding') {
      change.phase = 'ride';
      const npcs = this.state.npcs.map((npc) => npc.id === 'p1'
        ? { ...npc, zoneId: 'cabin' as const, intent: { kind: 'walk' as const, targetId: 'seat-1', sequence: 2 } }
        : npc);
      change.npcs = npcs;
      change.message = 'Посадка завершена. Алексей направляется к месту.';
    }
    if (time >= 8 && !this.signShown) {
      this.signShown = true;
      this.firstSignTime = time;
      this.showScenario(change);
    }
    if (this.scenario === 'fire' && this.signShown && !this.resolved && time >= 25 && !this.fireSevere) {
      this.fireSevere = true;
      change.cues = [{ id: 'fire-severe', kind: 'fire', text: 'Пламя усиливается!', anchorId: 'fire-zone' }];
      change.message = 'Пожар усилился. Требуется подготовленный огнетушитель.';
      change.metrics = { safety: 55, satisfaction: 83 };
    }
    if (this.scenario === 'pressure' && this.signShown && !this.reported && time >= 30) {
      change.metrics = { safety: 65, satisfaction: 80 };
    }
    if ((this.scenario === 'service' || this.scenario === 'conflict') && this.state.tasks[0]?.state === 'open') {
      const task = this.state.tasks[0];
      if (task !== undefined && time >= task.hardDeadline) {
        change.tasks = [{ ...task, state: 'failed' }];
        change.metrics = { safety: 100, satisfaction: 50 };
        change.message = 'Срок просьбы истёк. Пассажир остался недоволен.';
      }
    }
    this.delta(change);
  }

  private showScenario(change: SnapshotPatch): void {
    const npcs = this.state.npcs.map((npc) => {
      if (this.scenario === 'pressure' && npc.id === 'p2') {
        return { ...npc, speech: 'Что-то давит на уши…', intent: { kind: 'call' as const, targetId: 'seat-2', sequence: 2 } };
      }
      if (this.scenario === 'service' && npc.id === 'p2') {
        return { ...npc, speech: 'Помогите с грязным местом!', intent: { kind: 'call' as const, targetId: 'seat-2', sequence: 2 } };
      }
      if (this.scenario === 'conflict' && npc.id === 'p3') {
        return { ...npc, speech: 'Мы не можем поделить место!', intent: { kind: 'complain' as const, targetId: 'seat-3', sequence: 2 } };
      }
      if (this.scenario === 'fire' && npc.id === 'p4') {
        return { ...npc, speech: 'Кажется, пахнет дымом!', intent: { kind: 'react' as const, targetId: 'service', sequence: 2 } };
      }
      return npc;
    });
    change.npcs = npcs;
    if (this.scenario === 'pressure') {
      change.cues = [
        { id: 'whistle', kind: 'whistle', text: 'В вагоне слышен слабый свист.' },
        { id: 'pressure-call', kind: 'call', text: 'Мария жалуется на самочувствие.', sourceId: 'p2' },
      ];
      change.message = 'Слышен слабый свист. Пассажир жалуется на заложенность ушей.';
    } else if (this.scenario === 'fire') {
      change.poi = [...this.state.poi, { id: 'fire-zone', kind: 'fire', label: 'Очаг', zoneId: 'cabin',
        observation: 'Видны дым и небольшой огонь.',
        actions: [this.state.item === 'prepared'
          ? action('use', 'use-item', 'Применить огнетушитель')
          : blockedAction('use', 'use-item', 'Применить огнетушитель', 'Сначала подготовьте огнетушитель')] }];
      change.cues = [{ id: 'smoke', kind: 'smoke', text: 'Появился дым!', anchorId: 'fire-zone' }];
      change.message = 'В проходе появился дым. Найдите огнетушитель.';
    } else {
      const service = this.scenario === 'service';
      const task: TaskView = {
        id: service ? 'dirty-seat' : 'conflict', sourceId: service ? 'p2' : 'p3',
        title: service ? 'Помочь с грязным местом' : 'Разрешить спор о месте',
        targetId: service ? 'seat-2' : 'seat-3', urgency: service ? 'normal' : 'urgent',
        state: 'open', softDeadline: service ? 35 : 25, hardDeadline: service ? 55 : 45,
        actions: service ? [action('complete', 'complete-task', 'Завершить задачу')] : [],
      };
      change.tasks = [task];
      change.cues = [{ id: task.id, kind: 'call', text: service ? 'Пассажир просит помочь с местом.' : 'Пассажиры спорят.', anchorId: task.targetId }];
      change.message = service ? 'Пассажир сообщает о грязном месте.' : 'Между пассажирами возник спор.';
    }
  }

  handle(socket: WebSocket, command: ClientMessage & { type: 'command' }): void {
    if (this.seen.has(command.requestId)) {
      this.send(socket, { type: 'ack', protocolVersion: 1, sessionId: this.id, requestId: command.requestId, revision: this.state.revision });
      return;
    }
    const patch: SnapshotPatch = {};
    const reject = (reason: string): void => {
      this.send(socket, { type: 'reject', protocolVersion: 1, sessionId: this.id, requestId: command.requestId, reason });
    };
    if (command.sessionId !== this.id || command.baseRevision > this.state.revision) {
      reject('Устаревшая или чужая сессия.'); return;
    }
    if (command.kind === 'dev-control') {
      if (command.optionId === 'disconnect') {
        this.send(socket, { type: 'ack', protocolVersion: 1, sessionId: this.id,
          requestId: command.requestId, revision: this.state.revision });
        setTimeout(() => socket.close(), 50);
        return;
      }
      if (isScenario(command.optionId)) {
        this.scenario = command.optionId;
        this.state = createSnapshot(this.id, this.scenario);
        this.signShown = false; this.fireSevere = false; this.reported = false; this.resolved = false;
        this.serviceResponse = 'none'; this.firstSignTime = 0; this.resolutionTime = null;
        this.seen.clear(); this.clarified.clear();
        this.send(socket, { type: 'ack', protocolVersion: 1, sessionId: this.id, requestId: command.requestId, revision: 1 });
        for (const client of this.clients) this.snapshot(client);
        return;
      }
      if (command.speed === 0 || command.speed === 1 || command.speed === 3) {
        patch.controls = { speed: command.speed };
        patch.message = command.speed === 0 ? 'Стенд на паузе.' : `Скорость стенда ×${command.speed}.`;
      } else { reject('Неизвестная команда стенда.'); return; }
    } else if (command.kind === 'move-zone') {
      const zone = command.zoneId;
      const paths: Record<string, string[]> = {
        platform: ['vestibule'], vestibule: ['platform', 'cabin'],
        cabin: ['vestibule', 'service'], service: ['cabin'],
      };
      if (zone === undefined || !paths[this.state.playerZone]?.includes(zone)) {
        reject('Нет доступного перехода между зонами.'); return;
      }
      patch.playerZone = zone;
      patch.message = `Переход в зону: ${zone}.`;
    } else if (command.kind === 'talk') {
      const npc = this.state.npcs.find((entry) => entry.id === command.targetId);
      if (npc === undefined || npc.zoneId !== this.state.playerZone) { reject('Пассажир вне зоны разговора.'); return; }
      patch.dialogue = dialogueFor(npc.id, this.scenario, this.clarified.has(npc.id));
    } else if (command.kind === 'dialogue-choice') {
      const active = this.state.dialogue;
      if (active === null || !active.options.some((option) => option.id === command.optionId && option.enabled)) {
        reject('Вариант ответа недоступен.'); return;
      }
      if (command.optionId === 'clarify') {
        this.clarified.add(active.npcId);
        patch.dialogue = dialogueFor(active.npcId, this.scenario, true);
        patch.message = 'Обстоятельства уточнены. Доступны новые действия.';
      } else {
        patch.dialogue = null;
        patch.message = command.optionId === 'dismiss' || command.optionId === 'reject'
          ? 'Пассажир недоволен решением.' : 'Пассажир услышал ваш ответ.';
        if (active.id === 'pressure-complaint' && command.optionId === 'check-panel') {
          patch.cues = [
            ...this.state.cues,
            { id: 'pressure-panel', kind: 'pressure', text: 'После уточнения проверьте панель давления.', anchorId: 'panel' },
          ];
          patch.message = 'Пассажир уточнил симптомы. Проверьте панель давления.';
        }
        if (active.id === 'documents') {
          const admitted = command.optionId === 'admit';
          patch.message = admitted ? 'Документы сверены. Пассажир допущен к посадке.' : 'Пассажиру отказано в посадке.';
          patch.npcs = this.state.npcs.map((npc) => npc.id === active.npcId ? {
            ...npc, speech: admitted ? 'Спасибо, прохожу к месту.' : 'Мне отказали в посадке.',
            intent: { kind: 'walk' as const, targetId: admitted ? 'seat-1' : 'platform-1', sequence: npc.intent.sequence + 1 },
          } : npc);
          patch.metrics = { safety: 100, satisfaction: admitted ? 96 : 65 };
        }
        if (active.id === 'dirty-seat') {
          this.serviceResponse = command.optionId === 'promise-service' ? 'assured' : 'dismissed';
          if (this.serviceResponse === 'dismissed') patch.metrics = { safety: 100, satisfaction: 72 };
        }
        if (active.id === 'passenger-conflict' && command.optionId === 'dismiss') {
          patch.metrics = { safety: 100, satisfaction: 68 };
        }
        if (command.optionId === 'check-tickets') {
          patch.tasks = this.state.tasks.map((task) => task.id === 'conflict' ? { ...task, state: 'completed' } : task);
          patch.metrics = { safety: 100, satisfaction: 94 };
          this.resolutionTime = this.state.simulationTime;
        }
      }
    } else if (command.kind === 'inspect' && command.targetId === 'panel') {
      const panel = this.state.poi.find((entry) => entry.id === 'panel');
      if (this.state.playerZone !== 'cabin' || panel === undefined) { reject('Панель вне зоны доступа.'); return; }
      const observation = command.inspection === 'full'
        ? (this.signShown && this.scenario === 'pressure' ? 'Показание: 0,72 нормы. Требуется доклад.' : 'Показание: норма.')
        : (panel.observation?.startsWith('Показание:') ?? false)
          ? panel.observation as string
          : (this.signShown && this.scenario === 'pressure' ? 'Есть отклонение показания.' : 'Внешних отклонений нет.');
      patch.poi = this.state.poi.map((entry) => entry.id === 'panel' ? {
        ...entry, observation,
        actions: observation.includes('0,72') && !this.reported
          ? [...entry.actions.filter((entryAction) => entryAction.id !== 'report'), action('report', 'report', 'Доложить о показании')]
          : entry.actions,
      } : entry);
      patch.message = observation;
    } else if (command.kind === 'report' && command.targetId === 'panel') {
      const panel = this.state.poi.find((entry) => entry.id === 'panel');
      if (this.scenario !== 'pressure' || this.reported || !panel?.observation?.includes('0,72')) {
        reject('Для доклада нужно точное наблюдаемое показание.'); return;
      }
      this.reported = true;
      this.resolutionTime = this.state.simulationTime;
      patch.message = 'Неисправность доложена. Меры безопасности согласованы.';
      patch.metrics = { safety: this.state.simulationTime >= 30 ? 65 : 89, satisfaction: 87 };
      patch.cues = [{ id: 'reported', kind: 'notice', text: 'Доклад принят.', anchorId: 'panel' }];
      patch.poi = this.state.poi.map((entry) => entry.id === 'panel' ? {
        ...entry, actions: entry.actions.map((entryAction) => entryAction.id === 'report'
          ? blockedAction('report', 'report', 'Доложить о показании', 'Доклад уже принят') : entryAction),
      } : entry);
    } else if (command.kind === 'take-item' && command.targetId === 'extinguisher') {
      if (this.state.playerZone !== 'service' || this.state.item !== 'stored') { reject('Огнетушитель недоступен.'); return; }
      patch.item = 'held'; patch.message = 'Огнетушитель взят. Перед применением подготовьте его.';
      patch.poi = this.state.poi.map((entry) => entry.id === 'extinguisher' ? {
        ...entry, actions: [blockedAction('take', 'take-item', 'Взять огнетушитель', 'Уже в руках')],
      } : entry);
    } else if (command.kind === 'interact' && command.targetId === 'extinguisher') {
      if (this.state.item !== 'held') { reject('Сначала возьмите огнетушитель.'); return; }
      patch.item = 'prepared'; patch.message = 'Огнетушитель подготовлен.';
      if (this.state.poi.some((entry) => entry.id === 'fire-zone')) {
        patch.poi = this.state.poi.map((entry) => entry.id === 'fire-zone' ? {
          ...entry, actions: [action('use', 'use-item', 'Применить огнетушитель')],
        } : entry);
      }
    } else if (command.kind === 'use-item' && command.targetId === 'fire-zone') {
      if (this.scenario !== 'fire' || !this.signShown || this.state.playerZone !== 'cabin' || this.state.item !== 'prepared') {
        reject('Нужен подготовленный огнетушитель рядом с очагом.'); return;
      }
      this.resolved = true;
      this.resolutionTime = this.state.simulationTime;
      patch.item = 'used'; patch.poi = this.state.poi.filter((entry) => entry.id !== 'fire-zone');
      patch.cues = [{ id: 'resolved', kind: 'notice', text: 'Очаг потушен.' }];
      patch.message = 'Очаг потушен. Событие зафиксировано.';
      patch.metrics = { safety: this.fireSevere ? 61 : 91, satisfaction: this.fireSevere ? 75 : 90 };
    } else if (command.kind === 'complete-task') {
      const task = this.state.tasks.find((entry) => entry.id === command.targetId);
      if (task?.state !== 'open' || task.id !== 'dirty-seat' || this.state.playerZone !== 'cabin') {
        reject('Задача недоступна в текущем состоянии.'); return;
      }
      patch.tasks = this.state.tasks.map((entry) => entry.id === task.id ? { ...entry, state: 'completed' } : entry);
      this.resolutionTime = this.state.simulationTime;
      const satisfaction = this.serviceResponse === 'assured'
        ? (this.state.simulationTime > task.softDeadline ? 82 : 95)
        : this.serviceResponse === 'dismissed'
          ? (this.state.simulationTime > task.softDeadline ? 55 : 75)
          : (this.state.simulationTime > task.softDeadline ? 65 : 82);
      patch.metrics = { safety: 100, satisfaction };
      patch.message = 'Просьба выполнена. Пассажир получил ответ.';
    } else if (command.kind === 'finish') {
      const success = this.scenario === 'pressure' ? this.reported
        : this.scenario === 'fire' ? this.resolved
          : this.state.tasks.some((task) => task.state === 'completed');
      const metrics = this.state.metrics ?? { safety: 100, satisfaction: 100 };
      patch.phase = 'finished';
      patch.dialogue = null;
      patch.debrief = {
        title: success ? 'Смена завершена' : 'Смена завершена с упущением',
        safety: success ? metrics.safety : Math.min(metrics.safety, this.scenario === 'fire' ? 35 : 70),
        satisfaction: success ? metrics.satisfaction : Math.min(metrics.satisfaction, 58),
        process: [success ? 'Ключевое действие выполнено.' : 'Ключевое действие не выполнено.',
          this.resolutionTime === null
            ? 'Реакция на основной сигнал не зафиксирована.'
            : `От первого сигнала до действия: ${Math.max(0, this.resolutionTime - this.firstSignTime).toFixed(1)} с.`],
        outcome: [this.scenario === 'fire' && !this.resolved ? 'Очаг остался активным.'
          : success ? 'Наблюдаемый запрос или инцидент закрыт.' : 'Запрос или инцидент остался открытым.'],
      };
      patch.message = 'Итог смены готов.';
    } else { reject('Действие недоступно в этой пробе.'); return; }

    this.seen.add(command.requestId);
    this.send(socket, { type: 'ack', protocolVersion: 1, sessionId: this.id, requestId: command.requestId, revision: this.state.revision + 1 });
    this.delta(patch);
  }

  private delta(patch: SnapshotPatch): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    const message = { type: 'delta', protocolVersion: 1, sessionId: this.id, revision: this.state.revision, patch };
    for (const socket of this.clients) this.send(socket, message);
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}

/** Development-only WebSocket fixture mounted on Vite's HTTP server. */
export function demoGamePlugin(): Plugin {
  const sessions = new Map<string, DemoSession>();
  let sequence = 0;
  return {
    name: 'vsm-demo-game-websocket', apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return;
      const webSocketServer = new WebSocketServer({ noServer: true });
      const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== '/game-ws') return;
        webSocketServer.handleUpgrade(request, socket, head, (peer) => {
          peer.on('message', (bytes) => {
            let incoming: ClientMessage;
            try { incoming = JSON.parse(bytes.toString()) as ClientMessage; } catch { return; }
            if (incoming.protocolVersion !== PROTOCOL_VERSION) { peer.close(1002, 'Protocol version'); return; }
            if (incoming.type === 'hello') {
              let session = incoming.sessionId === undefined ? undefined : sessions.get(incoming.sessionId);
              if (session === undefined) {
                const scenario = isScenario(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') as Scenario : 'pressure';
                session = new DemoSession(`demo-${++sequence}`, scenario);
                sessions.set(session.id, session);
              }
              session.attach(peer);
            } else if (incoming.type === 'resync') {
              sessions.get(incoming.sessionId)?.snapshot(peer);
            } else if (incoming.type === 'command') {
              sessions.get(incoming.sessionId)?.handle(peer, incoming);
            }
          });
        });
      };
      server.httpServer?.on('upgrade', upgrade);
      const ticker = setInterval(() => { for (const session of sessions.values()) session.tick(); }, 250);
      server.httpServer?.on('close', () => {
        clearInterval(ticker);
        server.httpServer?.off('upgrade', upgrade);
        webSocketServer.close();
      });
    },
  };
}
