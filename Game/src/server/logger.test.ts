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

  it('redacts authentication secrets from structured fields', () => {
    const destination = new PassThrough();
    let output = '';
    destination.setEncoding('utf8');
    destination.on('data', (chunk: string) => {
      output += chunk;
    });

    createServerLogger(destination).info(
      {
        event: 'redaction-test',
        sessionKey: 'session-secret',
        resumeToken: 'resume-secret',
        serviceToken: 'service-secret',
        headers: { authorization: 'Bearer secret' },
      },
      'Sensitive data test',
    );

    expect(output).not.toContain('session-secret');
    expect(output).not.toContain('resume-secret');
    expect(output).not.toContain('service-secret');
    expect(output).not.toContain('Bearer secret');
    expect(JSON.parse(output)).toMatchObject({
      sessionKey: '[REDACTED]',
      resumeToken: '[REDACTED]',
      serviceToken: '[REDACTED]',
      headers: { authorization: '[REDACTED]' },
    });
  });
});
