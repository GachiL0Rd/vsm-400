import { describe, expect, it, vi } from 'vitest';
import { isBlockedIp, screenWebhookUrl, TEST_WEBHOOK_IP, type WebhookResolve } from './webhook-url';

const open: WebhookResolve = async () => [{ address: TEST_WEBHOOK_IP, family: 4 }];
const prod = { nodeEnv: 'production' as const, allowedHosts: [] };
const dev = { nodeEnv: 'development' as const, allowedHosts: [] };

describe('адрес вебхука', () => {
  it('отклоняет частные, loopback, link-local, CGNAT и metadata до DNS', async () => {
    const resolve = vi.fn(open);
    const blocked = [
      'HTTP://127.0.0.1/hook',
      'https://127.0.0.1/hook',
      'https://2130706433/hook',
      'https://0x7f000001/hook',
      'https://127.1/hook',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://10.0.0.1/hook',
      'https://192.168.1.20/hook',
      'https://172.16.5.1/hook',
      'https://169.254.169.254/latest',
      'https://100.64.0.1/hook',
      'https://0.0.0.0/hook',
      'https://224.0.0.1/hook',
      'https://localhost/hook',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://instance-data.ec2.internal/',
    ];
    for (const url of blocked) {
      const screened = await screenWebhookUrl(url, dev, resolve);
      expect(screened.ok, url).toBe(false);
      if (!screened.ok) {
        expect(screened.reason, url).toBe('ssrf');
      }
    }
    const prodHttp = await screenWebhookUrl('HTTP://127.0.0.1/hook', prod, resolve);
    expect(prodHttp.ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('в production принимает только https и режет частный ответ DNS', async () => {
    const http = await screenWebhookUrl('http://lms.example/hook', prod, open);
    expect(http).toEqual({ ok: false, reason: 'https' });
    const devHttp = await screenWebhookUrl('http://1.1.1.1/hook', dev, open);
    expect(devHttp.ok).toBe(true);
    const literal = await screenWebhookUrl('https://8.8.8.8/hook', prod, open);
    expect(literal.ok).toBe(true);
    if (literal.ok) {
      expect(literal.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
    }
    const mixed = await screenWebhookUrl('https://lms.example/hook', prod, async () => [
      { address: TEST_WEBHOOK_IP, family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]);
    expect(mixed).toEqual({ ok: false, reason: 'ssrf' });
    const loop = await screenWebhookUrl('https://lms.example/hook', prod, async () => [
      { address: '::ffff:7f00:1', family: 6 },
    ]);
    expect(loop).toEqual({ ok: false, reason: 'ssrf' });
  });

  it('allowlist не открывает частную сеть', async () => {
    const policy = { nodeEnv: 'production' as const, allowedHosts: ['lms.example'] };
    const foreign = await screenWebhookUrl('https://evil.example/hook', policy, open);
    expect(foreign).toEqual({ ok: false, reason: 'allowlist' });
    const pinned = await screenWebhookUrl('https://LMS.EXAMPLE./hook', policy, open);
    expect(pinned.ok).toBe(true);
    const insider = await screenWebhookUrl('https://lms.example/hook', policy, async () => [
      { address: '192.168.0.5', family: 4 },
    ]);
    expect(insider).toEqual({ ok: false, reason: 'ssrf' });
    const creds = await screenWebhookUrl(
      `https://${'user'}:${'secret'}@lms.example/hook`,
      policy,
      open,
    );
    expect(creds).toEqual({ ok: false, reason: 'url' });
    const down = await screenWebhookUrl('https://lms.example/hook', policy, async () => {
      throw new Error('servfail');
    });
    expect(down).toEqual({ ok: false, reason: 'dns' });
  });

  it('считает mapped loopback частным', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIp('2001:db8::1')).toBe(false);
    expect(isBlockedIp('100.127.255.255')).toBe(true);
    expect(isBlockedIp('100.128.0.1')).toBe(false);
    expect(isBlockedIp('198.18.0.1')).toBe(true);
    expect(isBlockedIp('192.0.0.8')).toBe(true);
    expect(isBlockedIp('192.0.2.1')).toBe(true);
    expect(isBlockedIp('198.51.100.1')).toBe(true);
    expect(isBlockedIp('203.0.113.10')).toBe(true);
    expect(isBlockedIp(TEST_WEBHOOK_IP)).toBe(false);
    expect(isBlockedIp('2002:0808:0808::')).toBe(true);
    expect(isBlockedIp('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedIp('64:ff9b::127.0.0.1')).toBe(true);
    expect(isBlockedIp('64:ff9b::808:808')).toBe(false);
    expect(isBlockedIp('64:ff9b:1:7f00:0:100::')).toBe(true);
    expect(isBlockedIp('64:ff9b:1:808:8:800::')).toBe(false);
  });
});
