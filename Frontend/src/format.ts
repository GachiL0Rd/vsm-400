const numberFormat = new Intl.NumberFormat('ru-RU');
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const DAY = 24 * 60 * 60 * 1000;

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** +5, −20, 0 — с настоящим минусом. */
export function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

export function formatDate(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «сегодня», «вчера», «3 дня назад». */
export function formatAgo(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
}

/** «через 3 дня», «завтра». */
export function formatIn(iso: string, now = Date.now()): string {
  const days = Math.ceil((new Date(iso).getTime() - now) / DAY);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}
