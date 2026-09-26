declare module 'pg' {
  export class Client {
    constructor(config: { connectionString: string; connectionTimeoutMillis?: number });
    connect(): Promise<void>;
    end(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
  }
}
