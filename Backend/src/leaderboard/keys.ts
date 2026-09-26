export const BOARD_SCOPES = ['brigade', 'depot', 'company'] as const;

export type BoardScope = (typeof BOARD_SCOPES)[number];

export function isBoardScope(value: string): value is BoardScope {
  return (BOARD_SCOPES as readonly string[]).includes(value);
}

export function brigadeBoardKey(seasonId: string, brigadeId: string): string {
  return `lb:${seasonId}:brigade:${brigadeId}`;
}

export function depotBoardKey(seasonId: string, depotId: string): string {
  return `lb:${seasonId}:depot:${depotId}`;
}

export function companyBoardKey(seasonId: string): string {
  return `lb:${seasonId}:company`;
}

export function boardKey(seasonId: string, scope: BoardScope, scopeId: string | null): string {
  if (scope === 'brigade') {
    return brigadeBoardKey(seasonId, scopeId ?? '');
  }
  if (scope === 'depot') {
    return depotBoardKey(seasonId, scopeId ?? '');
  }
  return companyBoardKey(seasonId);
}

/** Снимок рангов. У компании нет id — ключ доски плюс :snap. */
export function snapKey(key: string): string {
  return `${key}:snap`;
}

export function appliedRunKey(runId: string): string {
  return `lb:applied:${runId}`;
}
