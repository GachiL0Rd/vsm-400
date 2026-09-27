import pino, { type DestinationStream, type Logger } from 'pino';

const serviceName = 'vsm-game-server';

export function createServerLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      base: { service: serviceName },
      level: 'info',
    },
    destination,
  );
}
