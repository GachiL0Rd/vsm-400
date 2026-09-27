import { tokens } from './text-norm';
import type { VariantPayload } from './validate-variant';

export type SimilarityHit = {
  score: number;
  against: string;
};

export function variantBundle(payload: {
  text: string;
  choices: readonly { text: string }[];
}): string {
  return [payload.text, ...payload.choices.map((choice) => choice.text)].join(' ');
}

/** Jaccard по нормализованным словам. Пустая сторона — 0, чтобы не путать с копией. */
export function wordJaccard(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

export function similarityHit(
  candidate: VariantPayload,
  source: { text: string; choices: readonly { text: string }[] },
  existing: readonly { id: string; payload: VariantPayload }[],
  maxSimilarity: number,
): SimilarityHit | null {
  const text = variantBundle(candidate);
  const sourceScore = wordJaccard(text, variantBundle(source));
  if (sourceScore > maxSimilarity) {
    return { score: sourceScore, against: 'исходник' };
  }
  for (const row of existing) {
    const score = wordJaccard(text, variantBundle(row.payload));
    if (score > maxSimilarity) {
      return { score, against: row.id };
    }
  }
  return null;
}

export function similarityReason(hit: SimilarityHit): string {
  const score = hit.score.toFixed(2);
  if (hit.against === 'исходник') {
    return `сходство ${score} с исходником`;
  }
  return `сходство ${score} с вариантом ${hit.against}`;
}
