import { ACHIEVEMENT_GRANTED, PROMOTION_RECOMMENDED, RUN_RECORDED } from '../common/events';

export const API_SCOPES_KEY = 'apiClientScopes';

export const API_SCOPES = [
  'employees:write',
  'progress:read',
  'org:read',
  'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** События, на которые HR может подписаться. Имена совпадают с шиной. */
export const WEBHOOK_EVENTS = [RUN_RECORDED, ACHIEVEMENT_GRANTED, PROMOTION_RECOMMENDED] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
