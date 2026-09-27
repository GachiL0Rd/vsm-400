import { randomBytes } from 'node:crypto';

export interface ResumeTokenRegistry {
  issue(attemptId: string, expiresAtMs: number): string;
  validate(token: string, attemptId: string, nowMs: number): boolean;
  revokeAttempt(attemptId: string): void;
}

interface TokenRecord {
  readonly attemptId: string;
  readonly expiresAtMs: number;
}

export class InMemoryResumeTokenRegistry implements ResumeTokenRegistry {
  private readonly records = new Map<string, TokenRecord>();

  issue(attemptId: string, expiresAtMs: number): string {
    const token = randomBytes(24).toString('base64url');
    this.records.set(token, { attemptId, expiresAtMs });
    return token;
  }

  validate(token: string, attemptId: string, nowMs: number): boolean {
    const record = this.records.get(token);
    if (record === undefined || record.attemptId !== attemptId || record.expiresAtMs < nowMs)
      return false;
    return true;
  }

  revokeAttempt(attemptId: string): void {
    for (const [token, record] of this.records)
      if (record.attemptId === attemptId) this.records.delete(token);
  }
}
