import { randomBytes } from 'node:crypto';

export interface ResumeTokenRegistry {
  issue(attemptId: string, expiresAtMs: number): string;
  validate(token: string, attemptId: string, nowMs: number): boolean;
  resolve(token: string, nowMs: number): string | null;
  revokeAttempt(attemptId: string): void;
}

interface TokenRecord {
  readonly attemptId: string;
  readonly expiresAtMs: number;
}

export class InMemoryResumeTokenRegistry implements ResumeTokenRegistry {
  private readonly records = new Map<string, TokenRecord>();

  issue(attemptId: string, expiresAtMs: number): string {
    this.revokeAttempt(attemptId);
    const token = randomBytes(24).toString('base64url');
    this.records.set(token, { attemptId, expiresAtMs });
    return token;
  }

  validate(token: string, attemptId: string, nowMs: number): boolean {
    const record = this.currentRecord(token, nowMs);
    return record?.attemptId === attemptId;
  }

  resolve(token: string, nowMs: number): string | null {
    return this.currentRecord(token, nowMs)?.attemptId ?? null;
  }

  private currentRecord(token: string, nowMs: number): TokenRecord | null {
    const record = this.records.get(token);
    if (record === undefined) return null;
    if (record.expiresAtMs < nowMs) {
      this.records.delete(token);
      return null;
    }
    return record;
  }

  revokeAttempt(attemptId: string): void {
    for (const [token, record] of this.records)
      if (record.attemptId === attemptId) this.records.delete(token);
  }
}
