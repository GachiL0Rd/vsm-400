/** Шкалы лояльности и безопасности живут в 0..100, ниже нуля игрок не уходит. */
export function clampScale(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}
