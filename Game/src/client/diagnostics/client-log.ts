export type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ClientLogEntry {
  readonly sequence: number;
  readonly runId: string;
  readonly at: string;
  readonly level: ClientLogLevel;
  readonly source: string;
  readonly event: string;
  readonly data?: unknown;
}

interface StoredLog {
  readonly schemaVersion: 1;
  readonly dropped: number;
  readonly entries: ClientLogEntry[];
}

export interface ClientLoggerOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  output?: Pick<Console, ClientLogLevel>;
  maxEntries?: number;
}

const STORAGE_KEY = 'vsm-game.client-log.v1';
const MAX_ENTRIES = 5_000;
const SENSITIVE_KEY =
  /token|secret|password|cookie|authorization|credential|session.?key|^input$|action.?input/i;
const LEVELS = new Set<ClientLogLevel>(['debug', 'info', 'warn', 'error']);

/** A bounded, exportable client journal. Callers pass metadata, never raw wire payloads. */
export class ClientLogger {
  private readonly storage: ClientLoggerOptions['storage'];
  private readonly output: Pick<Console, ClientLogLevel>;
  private readonly maxEntries: number;
  private readonly runId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  private entries: ClientLogEntry[] = [];
  private nextSequence = 1;
  private dropped = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ClientLoggerOptions = {}) {
    this.storage = options.storage;
    this.output = options.output ?? console;
    this.maxEntries = Math.max(1, options.maxEntries ?? MAX_ENTRIES);
    this.restore();
  }

  record(level: ClientLogLevel, source: string, event: string, data?: unknown): void {
    const entry: ClientLogEntry = {
      sequence: this.nextSequence++,
      runId: this.runId,
      at: new Date().toISOString(),
      level,
      source,
      event,
      ...(data === undefined ? {} : { data: sanitize(data) }),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
      this.dropped += 1;
    }
    this.output[level](`[game:${source}] ${event}`, entry.data ?? '');
    this.scheduleFlush();
  }

  getEntries(): readonly ClientLogEntry[] {
    return JSON.parse(JSON.stringify(this.entries)) as ClientLogEntry[];
  }

  exportJson(): string {
    this.flush();
    return JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        dropped: this.dropped,
        entries: this.entries,
      },
      null,
      2,
    );
  }

  download(): void {
    this.record('info', 'diagnostics', 'log-download');
    const blob = new Blob([this.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vsm-client-log-${new Date().toISOString().replaceAll(':', '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  clear(): void {
    this.entries = [];
    this.nextSequence = 1;
    this.dropped = 0;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Logging must never stop gameplay when browser storage is unavailable.
    }
  }

  flush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, dropped: this.dropped, entries: this.entries }),
      );
    } catch {
      // The in-memory journal and download remain available if storage is full.
    }
  }

  private scheduleFlush(): void {
    if (this.storage === undefined || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), 1_000);
  }

  private restore(): void {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw === undefined || raw === null) return;
      const saved = JSON.parse(raw) as Partial<StoredLog>;
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.entries)) return;
      this.entries = saved.entries
        .filter(isLogEntry)
        .slice(-this.maxEntries)
        .map((entry) => ({
          ...entry,
          ...(entry.data === undefined ? {} : { data: sanitize(entry.data) }),
        }));
      this.nextSequence = Math.max(0, ...this.entries.map((entry) => entry.sequence)) + 1;
      this.dropped = Math.max(0, Number(saved.dropped) || 0);
    } catch {
      // Corrupt or unavailable session storage starts a fresh journal.
    }
  }
}

function isLogEntry(value: unknown): value is ClientLogEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<ClientLogEntry>;
  return (
    Number.isSafeInteger(entry.sequence) &&
    typeof entry.runId === 'string' &&
    typeof entry.at === 'string' &&
    LEVELS.has(entry.level as ClientLogLevel) &&
    typeof entry.source === 'string' &&
    typeof entry.event === 'string'
  );
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/([?&](?:sessionKey|resumeToken|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
      .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
      .slice(0, 1_000);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || depth >= 5 || seen.has(value)) return '[omitted]';
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 40).map((item) => sanitize(item, depth + 1, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1, seen);
  }
  return result;
}
