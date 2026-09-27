/**
 * GigaChat scope PERS принимает один одновременный запрос.
 * LLM_CONCURRENCY больше 1 на этом scope даёт 429, очередь режет до одного.
 */
export function effectiveLlmConcurrency(
  provider: string,
  scope: string,
  requested: number,
): number {
  const normalizedScope = scope.trim() === '' ? 'GIGACHAT_API_PERS' : scope.trim();
  if (provider.trim() === 'gigachat' && normalizedScope === 'GIGACHAT_API_PERS') {
    return 1;
  }
  return requested;
}
