import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

const serviceName = 'vsm-game-server';
const redactedPaths = [
  'sessionKey',
  'resumeToken',
  'serviceToken',
  'authorization',
  '*.sessionKey',
  '*.resumeToken',
  '*.serviceToken',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
] as const;

export type ServerLogger = Logger;

export interface ServerLoggerOptions {
  readonly level?: string;
  readonly destination?: DestinationStream;
  readonly enabled?: boolean;
}

export function createServerLogger(options: ServerLoggerOptions | DestinationStream = {}): Logger {
  const normalized: ServerLoggerOptions = 'write' in options ? { destination: options } : options;
  const configuration: LoggerOptions = {
    base: { service: serviceName },
    level: normalized.level ?? 'info',
    enabled: normalized.enabled ?? true,
    redact: {
      paths: [...redactedPaths],
      censor: '[REDACTED]',
    },
  };
  return pino(configuration, normalized.destination);
}

export function createSilentServerLogger(): Logger {
  return createServerLogger({ enabled: false });
}
