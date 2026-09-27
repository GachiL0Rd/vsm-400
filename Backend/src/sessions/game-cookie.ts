export const TICKET_TTL_SEC = 2 * 60;
export const TICKET_REDIS_TTL_SEC = 300;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/** Полный маршрут ~1.9 ч сим-времени на 1x, плюс паузы реконнекта и запас. */
export const GAME_ATTEMPT_TTL_MS = 3 * 60 * 60 * 1000;
