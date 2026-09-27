export function formatClock(totalMinutes: number): string {
  const day = 24 * 60;
  const mod = ((Math.trunc(totalMinutes) % day) + day) % day;
  const hours = Math.floor(mod / 60);
  const minutes = mod % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}
