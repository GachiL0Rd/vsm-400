/** Восемь хекстетов IPv6 или null, если строка не адрес. Зона %eth0 и хвост a.b.c.d разбираются. */
export function ipv6Hextets(address: string): number[] | null {
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
