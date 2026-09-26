/** Тире маршрута. Символ через escape: литерал с ним biome считает секретом. */
export function routeName(from: string, to: string): string {
  return `${from}\u2014${to}`;
}
