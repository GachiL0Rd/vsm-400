import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { AppConfig } from '../config/env';

export const WEBHOOK_RESOLVE = Symbol('WEBHOOK_RESOLVE');
export const WEBHOOK_POST = Symbol('WEBHOOK_POST');

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type WebhookPolicy = {
  nodeEnv: AppConfig['nodeEnv'];
  allowedHosts: readonly string[];
};

export type WebhookResolve = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type ScreenedWebhook =
  | { ok: true; url: URL; addresses: ResolvedAddress[] }
  | { ok: false; reason: 'url' | 'https' | 'ssrf' | 'allowlist' | 'dns' };

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('224.0.0.0', 4, 'ipv4');
blocked.addSubnet('240.0.0.0', 4, 'ipv4');
blocked.addSubnet('198.18.0.0', 15, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.0.2.0', 24, 'ipv4');
blocked.addSubnet('198.51.100.0', 24, 'ipv4');
blocked.addSubnet('203.0.113.0', 24, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

const blockedNames = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.azure.com',
  'instance-data',
  'instance-data.ec2.internal',
]);

export function webhookUrlDetail(reason: Exclude<ScreenedWebhook, { ok: true }>['reason']): string {
  if (reason === 'https') {
    return 'В production нужен https';
  }
  if (reason === 'allowlist') {
    return 'Хост вебхука не разрешён';
  }
  if (reason === 'dns') {
    return 'Имя вебхука не резолвится';
  }
  if (reason === 'ssrf') {
    return 'Адрес вебхука недоступен';
  }
  return 'Некорректный URL вебхука';
}

/** Публичный адрес: 203.0.113.0/24 теперь в SSRF-списке. */
export const TEST_WEBHOOK_IP = '203.0.114.10';

/** В тестах сеть не нужна: политика адресов проверяется отдельным резолвером. */
export const testWebhookResolve: WebhookResolve = async () => [
  { address: TEST_WEBHOOK_IP, family: 4 },
];

export function webhookResolveFor(config: AppConfig): WebhookResolve {
  return config.nodeEnv === 'test' ? testWebhookResolve : resolveWebhookHost;
}

export async function resolveWebhookHost(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({
    address: row.address,
    family: row.family === 6 ? 6 : 4,
  }));
}

export function isBlockedIp(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) {
    return blocked.check(mapped, 'ipv4');
  }
  const nat = nat64Ipv4(address);
  if (nat === 'blocked') {
    return true;
  }
  if (nat) {
    return blocked.check(nat, 'ipv4');
  }
  if (isIP(address) === 4) {
    return blocked.check(address, 'ipv4');
  }
  if (isIP(address) === 6) {
    return blocked.check(address, 'ipv6');
  }
  return true;
}

/**
 * Разбор URL, схема, allowlist и все A/AAAA.
 * Частный адрес среди ответов DNS отклоняет имя целиком: иначе резолвер
 * может отдать его на следующей попытке.
 */
export async function screenWebhookUrl(
  raw: string,
  policy: WebhookPolicy,
  resolve: WebhookResolve,
): Promise<ScreenedWebhook> {
  const opened = openWebhook(raw, policy.nodeEnv);
  if (!opened.ok) {
    return opened;
  }
  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.includes(opened.host)) {
    return { ok: false, reason: 'allowlist' };
  }
  const resolved = await hostAddresses(opened.host, resolve);
  if (!resolved.ok) {
    return resolved;
  }
  return { ok: true, url: opened.url, addresses: resolved.addresses };
}

function openWebhook(
  raw: string,
  nodeEnv: WebhookPolicy['nodeEnv'],
): { ok: false; reason: 'url' | 'https' | 'ssrf' } | { ok: true; url: URL; host: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'url' };
  }
  if (url.username !== '' || url.password !== '' || !isWebhookProtocol(url.protocol)) {
    return { ok: false, reason: 'url' };
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    return { ok: false, reason: 'https' };
  }
  const host = bareHostname(url.hostname);
  if (host.length === 0) {
    return { ok: false, reason: 'url' };
  }
  if (blockedHostname(host)) {
    return { ok: false, reason: 'ssrf' };
  }
  return { ok: true, url, host };
}

function isWebhookProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

async function hostAddresses(
  host: string,
  resolve: WebhookResolve,
): Promise<{ ok: false; reason: 'ssrf' | 'dns' } | { ok: true; addresses: ResolvedAddress[] }> {
  const literal = isIP(host);
  if (literal !== 0) {
    if (isBlockedIp(host)) {
      return { ok: false, reason: 'ssrf' };
    }
    return { ok: true, addresses: [{ address: host, family: literal === 6 ? 6 : 4 }] };
  }
  try {
    const addresses = await resolve(host);
    if (addresses.length === 0) {
      return { ok: false, reason: 'dns' };
    }
    if (addresses.some((item) => isBlockedIp(item.address))) {
      return { ok: false, reason: 'ssrf' };
    }
    return {
      ok: true,
      addresses: addresses.map((item) => ({ address: item.address, family: item.family })),
    };
  } catch {
    return { ok: false, reason: 'dns' };
  }
}

function bareHostname(hostname: string): string {
  const trimmed = hostname.toLowerCase().replace(/\.$/, '');
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function blockedHostname(hostname: string): boolean {
  if (blockedNames.has(hostname) || hostname.endsWith('.localhost')) {
    return true;
  }
  return (
    hostname.endsWith('.metadata.google.internal') || hostname.endsWith('.metadata.google.com')
  );
}

/**
 * NAT64 несёт IPv4 внутри. 64:ff9b::/96 — последние 32 бита.
 * 64:ff9b:1::/48 — вложение RFC 6052 для префикса /48, октет u должен быть 0.
 * Встроенный адрес проверяется тем же списком, что и обычный IPv4.
 */
function nat64Ipv4(address: string): string | 'blocked' | null {
  if (isIP(address) !== 6) {
    return null;
  }
  const parts = ipv6Hextets(address);
  if (!parts) {
    return 'blocked';
  }
  const [p0, p1, p2, p3, p4, p5, p6, p7] = parts;
  if (p0 === 0x64 && p1 === 0xff9b && p2 === 0 && p3 === 0 && p4 === 0 && p5 === 0) {
    return ipv4FromHextets(p6, p7);
  }
  if (p0 === 0x64 && p1 === 0xff9b && p2 === 0x0001) {
    if (p4 >> 8 !== 0) {
      return 'blocked';
    }
    const b0 = p3 >> 8;
    const b1 = p3 & 0xff;
    const b2 = p4 & 0xff;
    const b3 = p5 >> 8;
    return `${b0}.${b1}.${b2}.${b3}`;
  }
  return null;
}

function ipv4FromHextets(hi: number, lo: number): string {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function ipv6Hextets(address: string): number[] | null {
  const expanded = expandIpv6(stripZone(address.toLowerCase()));
  if (!expanded) {
    return null;
  }
  const nums: number[] = [];
  for (const part of expanded) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }
    nums.push(Number.parseInt(part, 16));
  }
  return nums;
}

function stripZone(address: string): string {
  const zone = address.indexOf('%');
  return zone === -1 ? address : address.slice(0, zone);
}

function expandIpv6(address: string): string[] | null {
  const plain = embedDottedTail(address);
  if (!plain) {
    return null;
  }
  const halves = plain.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':').filter((part) => part.length > 0) : [];
  const tail =
    halves.length === 2 && halves[1] ? halves[1].split(':').filter((part) => part.length > 0) : [];
  if (halves.length === 1 && head.length !== 8) {
    return null;
  }
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) {
    return null;
  }
  const full = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  return full.length === 8 ? full : null;
}

function embedDottedTail(address: string): string | null {
  if (!address.includes('.')) {
    return address;
  }
  const last = address.lastIndexOf(':');
  const octets = address
    .slice(last + 1)
    .split('.')
    .map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  const hi = ((octets[0] << 8) | octets[1]).toString(16);
  const lo = ((octets[2] << 8) | octets[3]).toString(16);
  return `${address.slice(0, last)}:${hi}:${lo}`;
}

function mappedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  if (!lower.startsWith('::ffff:')) {
    return null;
  }
  const rest = lower.slice('::ffff:'.length);
  if (isIP(rest) === 4) {
    return rest;
  }
  const parts = rest.split(':');
  const hiText = parts[0];
  const loText = parts[1];
  if (parts.length !== 2 || !hiText || !loText) {
    return null;
  }
  const hi = Number.parseInt(hiText, 16);
  const lo = Number.parseInt(loText, 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi > 0xffff || lo > 0xffff) {
    return null;
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}
