import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { postWebhookPinned } from './webhook-post';

describe('отправка вебхука', () => {
  it('идёт на проверенный адрес и обрывает тело ответа', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('x'.repeat(1024));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('нет порта');
    }
    const result = await postWebhookPinned({
      url: `http://lms.example:${address.port}/hook`,
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
      addresses: [{ address: '127.0.0.1', family: 4 }],
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    expect(result.status).toBe(200);
  });
});
