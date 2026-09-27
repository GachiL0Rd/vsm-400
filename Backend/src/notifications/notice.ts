import type { NotificationKind } from '../generated/prisma/client';

/** Форма Frontend Notice. kind шире кабинета: есть promotion и assignment. */
export type Notice = {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  at: string;
  unread: boolean;
  link?: string;
};

export type NoticeDraft = {
  kind: NotificationKind;
  title: string;
  text: string;
  link?: string;
  /** Глобально уникальный ключ идемпотентности. Пустой — каждый вызов новая строка. */
  dedupKey?: string;
};

export type NoticePage = {
  unreadCount: number;
  items: Notice[];
  nextCursor: string | null;
};

/** Канал фанаута между инстансами. Один канал на пользователя. */
export function notifyChannel(userId: string): string {
  return `vsm:notify:${userId}`;
}

export type NoticeRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
};

export function visibleLink(link: string | null | undefined): string | undefined {
  if (!link) {
    return undefined;
  }
  return link;
}

export function toNotice(row: NoticeRow): Notice {
  const notice: Notice = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    text: row.text,
    at: row.createdAt.toISOString(),
    unread: row.readAt === null,
  };
  const link = visibleLink(row.link);
  if (link) {
    notice.link = link;
  }
  return notice;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\n${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const splitAt = raw.indexOf('\n');
  if (splitAt <= 0) {
    return null;
  }
  const createdAt = new Date(raw.slice(0, splitAt));
  const id = raw.slice(splitAt + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    return null;
  }
  return { createdAt, id };
}
