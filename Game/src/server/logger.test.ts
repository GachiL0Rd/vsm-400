import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createServerLogger } from './logger.ts';

describe('createServerLogger', () => {
  it('writes structured records with the stable server service name', () => {
    const destination = new PassThrough();
    let output = '';
    destination.setEncoding('utf8');
    destination.on('data', (chunk: string) => {
      output += chunk;
    });

    createServerLogger(destination).info(
      { event: 'server-listening', host: '127.0.0.1', port: 4174 },
      'Server listening',
    );

    expect(JSON.parse(output)).toMatchObject({
      service: 'vsm-game-server',
      event: 'server-listening',
      host: '127.0.0.1',
      port: 4174,
      msg: 'Server listening',
    });
  });
});
