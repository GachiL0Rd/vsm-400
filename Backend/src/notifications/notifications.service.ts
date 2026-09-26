import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type MessageEvent,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Clock } from '../common/clock';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isUniqueViolation } from '../users/unique-violation';
import {
  decodeCursor,
  encodeCursor,
  type Notice,
  type NoticeDraft,
  type NoticePage,
  type NoticeRow,
  notifyChannel,
  toNotice,
} from './notice';

/** Прокси режет тихий SSE. 25 с — короче типичного idle в 30 с. */
export const HEARTBEAT_MS = 25_000;

const SEEN_LIMIT = 1_000;

type RedisSubscriber = {
  connect: () => Promise<unknown>;
  psubscribe: (pattern: string) => Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): void;
  on(
    event: 'pmessage',
    listener: (pattern: string, channel: string, message: string) => void,
  ): void;
  quit: () => Promise<unknown>;
  status?: string;
};

type PublishRedis = {
  publish?: (channel: string, message: string) => Promise<number>;
  duplicate?: () => RedisSubscriber;
};

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly subjects = new Map<string, Subject<Notice>>();
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private subscriber: RedisSubscriber | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    const factory = (this.redis as PublishRedis).duplicate;
    if (typeof factory !== 'function') {
      return;
    }
    try {
      const subscriber = factory.call(this.redis);
      subscriber.on('error', (error: Error) => {
        this.logger.error(error.message);
      });
      subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        this.deliverRemote(channel, message);
      });
      if (subscriber.status === 'wait') {
        await subscriber.connect();
      }
      await subscriber.psubscribe('vsm:notify:*');
      this.subscriber = subscriber;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const subject of this.subjects.values()) {
      subject.complete();
    }
    this.subjects.clear();
    if (!this.subscriber) {
      return;
    }
    await this.subscriber.quit();
    this.subscriber = null;
  }

  /** Пишет уведомление. Повтор с тем же dedupKey не создаёт вторую строку. */
  async create(userId: string, draft: NoticeDraft): Promise<Notice> {
    const saved = await this.saveNotice(userId, draft);
    const notice = toNotice(saved.row);
    if (!saved.fresh) {
      return notice;
    }
    this.remember(notice.id);
    this.subjects.get(userId)?.next(notice);
    await this.publish(userId, notice);
    return notice;
  }

  private async saveNotice(
    userId: string,
    draft: NoticeDraft,
  ): Promise<{ row: NoticeRow; fresh: boolean }> {
    if (draft.dedupKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { dedupKey: draft.dedupKey },
      });
      if (existing) {
        return { row: existing, fresh: false };
      }
    }
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId,
          kind: draft.kind,
          title: draft.title,
          text: draft.text,
          link: draft.link,
          dedupKey: draft.dedupKey,
        },
      });
      return { row, fresh: true };
    } catch (error) {
      if (!draft.dedupKey || !isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.prisma.notification.findUnique({
        where: { dedupKey: draft.dedupKey },
      });
      if (!existing) {
        throw error;
      }
      return { row: existing, fresh: false };
    }
  }

  async list(userId: string, limit: number, cursor?: string): Promise<NoticePage> {
    const where: Prisma.NotificationWhereInput = { userId };
    if (cursor) {
      const position = decodeCursor(cursor);
      if (!position) {
        throw new BadRequestException({ message: 'Курсор ленты не читается', code: 'BAD_CURSOR' });
      }
      where.OR = [
        { createdAt: { lt: position.createdAt } },
        { AND: [{ createdAt: position.createdAt }, { id: { lt: position.id } }] },
      ];
    }
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return {
      unreadCount,
      items: page.map((row) => toNotice(row)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async markRead(userId: string, id: string): Promise<Notice> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: this.clock.now() },
    });
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException({
        message: 'Уведомление не найдено',
        code: 'NOTIFICATION_NOT_FOUND',
      });
    }
    return toNotice(row);
  }

  async markAllRead(userId: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: this.clock.now() },
    });
    return { unreadCount: 0 };
  }

  /** Локальные подписчики плюс heartbeat. Чужие инстансы приходят через deliverRemote. */
  stream(userId: string): Observable<MessageEvent> {
    return new Observable((observer) => {
      let subject = this.subjects.get(userId);
      if (!subject) {
        subject = new Subject<Notice>();
        this.subjects.set(userId, subject);
      }
      const live = subject;
      const subscription = live.subscribe((notice) => {
        observer.next({ type: 'new-notification', data: notice });
      });
      const heartbeat = setInterval(() => {
        observer.next({ type: 'heartbeat', data: {} });
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        if (!live.observed) {
          this.subjects.delete(userId);
        }
      };
    });
  }

  /** Сообщение Redis pub/sub. Своя публикация уже ушла в Subject — id в seen. */
  deliverRemote(channel: string, message: string): void {
    const prefix = 'vsm:notify:';
    if (!channel.startsWith(prefix)) {
      return;
    }
    const userId = channel.slice(prefix.length);
    let notice: Notice;
    try {
      notice = JSON.parse(message) as Notice;
    } catch {
      return;
    }
    if (typeof notice.id !== 'string') {
      return;
    }
    if (!this.remember(notice.id)) {
      return;
    }
    this.subjects.get(userId)?.next(notice);
  }

  private remember(id: string): boolean {
    if (this.seen.has(id)) {
      return false;
    }
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_LIMIT) {
      const oldest = this.seenOrder.shift();
      if (oldest) {
        this.seen.delete(oldest);
      }
    }
    return true;
  }

  private async publish(userId: string, notice: Notice): Promise<void> {
    const publish = (this.redis as PublishRedis).publish;
    if (typeof publish !== 'function') {
      return;
    }
    try {
      await publish.call(this.redis, notifyChannel(userId), JSON.stringify(notice));
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }
}
