import { MEDICATION_STEMS, NAME_STEMS, NEW_FACT_STEMS } from './dictionaries';
import { TEXT_LIMIT } from './prompt';
import { containsAnchor, normalizeRu, signatureOf, stemRu, tokens } from './text-norm';

export type VariantPayload = {
  text: string;
  choices: { id: string; text: string }[];
};

export type ValidateSource = {
  text: string;
  choices: readonly { id: string; text: string }[];
  keep: readonly string[];
};

export type ValidateResult =
  | { ok: true; payload: VariantPayload }
  | { ok: false; reasons: string[] };

type Parsed = { ok: true; payload: VariantPayload } | { ok: false; reasons: string[] };

export function readVariantPayload(value: unknown): VariantPayload | null {
  const parsed = parsePayload(value);
  return parsed.ok ? parsed.payload : null;
}

const FORMAT_REASONS = new Set(['ответ не JSON', 'схема ответа', 'набор id выборов не совпал']);

/** Повтор генерации только из-за формы. Смысл, якоря и сходство сюда не входят. */
export function isFormatReject(reasons: readonly string[]): boolean {
  return reasons.length > 0 && reasons.every((reason) => FORMAT_REASONS.has(reason));
}

export function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) {
    return body;
  }
  return body.slice(start, end + 1);
}

export function validateVariant(raw: unknown, source: ValidateSource): ValidateResult {
  const parsed = parsePayload(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const shape = checkShape(parsed.payload, source);
  if (shape.length > 0) {
    return { ok: false, reasons: shape };
  }
  const payload = orderLikeSource(parsed.payload, source);
  const reasons = checkTexts(payload, source);
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true, payload };
}

function parsePayload(raw: unknown): Parsed {
  const value = typeof raw === 'string' ? parseJson(unwrapJson(raw)) : raw;
  if (value instanceof Error) {
    return { ok: false, reasons: [value.message] };
  }
  const record = asRecord(value);
  if (!record) {
    return { ok: false, reasons: ['схема ответа'] };
  }
  if (!sameKeys(record, ['text', 'choices'])) {
    return { ok: false, reasons: ['схема ответа'] };
  }
  if (typeof record.text !== 'string' || !Array.isArray(record.choices)) {
    return { ok: false, reasons: ['схема ответа'] };
  }
  const choices: { id: string; text: string }[] = [];
  for (const item of record.choices) {
    const choice = asRecord(item);
    if (!choice || !sameKeys(choice, ['id', 'text'])) {
      return { ok: false, reasons: ['схема ответа'] };
    }
    if (typeof choice.id !== 'string' || typeof choice.text !== 'string') {
      return { ok: false, reasons: ['схема ответа'] };
    }
    choices.push({ id: choice.id, text: choice.text.trim() });
  }
  return { ok: true, payload: { text: record.text.trim(), choices } };
}

function parseJson(raw: string): unknown | Error {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return new Error('ответ не JSON');
  }
}

function checkShape(payload: VariantPayload, source: ValidateSource): string[] {
  const expected = source.choices.map((choice) => choice.id);
  const got = payload.choices.map((choice) => choice.id);
  if (new Set(got).size !== got.length || !sameIdSet(expected, got)) {
    return ['набор id выборов не совпал'];
  }
  return [];
}

function checkTexts(payload: VariantPayload, source: ValidateSource): string[] {
  const reasons: string[] = [];
  const sourceBundle = bundle(source.text, source.choices);
  const outputBundle = bundle(payload.text, payload.choices);
  pushLength(reasons, payload.text, 'текст ситуации');
  if (normalizeRu(payload.text) === normalizeRu(source.text)) {
    reasons.push('текст ситуации совпал с исходником');
  }
  for (const choice of payload.choices) {
    pushLength(reasons, choice.text, `выбор ${choice.id}`);
    const original = source.choices.find((item) => item.id === choice.id);
    if (original && normalizeRu(choice.text) === normalizeRu(original.text)) {
      reasons.push(`выбор ${choice.id} совпал с исходником`);
    }
  }
  for (const anchor of source.keep) {
    if (!containsAnchor(outputBundle, anchor)) {
      reasons.push(`нет якоря: ${anchor}`);
    }
  }
  pushDigits(reasons, outputBundle, sourceBundle);
  pushLexicon(reasons, outputBundle, sourceBundle, MEDICATION_STEMS, 'лекарство');
  pushLexicon(reasons, outputBundle, sourceBundle, NAME_STEMS, 'имя');
  pushLexicon(reasons, outputBundle, sourceBundle, NEW_FACT_STEMS, 'новый факт');
  if (/[A-Za-z]/.test(outputBundle)) {
    reasons.push('латиница');
  }
  pushPairs(reasons, payload.choices);
  return reasons;
}

function pushLength(reasons: string[], text: string, label: string): void {
  if (text.length === 0) {
    reasons.push(`пустой текст: ${label}`);
    return;
  }
  if (text.length > TEXT_LIMIT) {
    reasons.push(`${label} длиннее ${TEXT_LIMIT}`);
  }
}

function pushDigits(reasons: string[], output: string, source: string): void {
  const allowed = new Set(source.match(/\d+/g) ?? []);
  for (const run of output.match(/\d+/g) ?? []) {
    if (!allowed.has(run)) {
      reasons.push(`новая цифра: ${run}`);
    }
  }
}

function pushLexicon(
  reasons: string[],
  output: string,
  source: string,
  lexicon: readonly string[],
  label: string,
): void {
  const known = new Set(tokens(source).map(stemRu));
  const seen = new Set<string>();
  for (const word of tokens(output)) {
    const stem = stemRu(word);
    if (known.has(stem) || seen.has(stem)) {
      continue;
    }
    if (!lexicon.some((item) => lexiconHit(stem, item))) {
      continue;
    }
    seen.add(stem);
    reasons.push(`${label}: ${word}`);
  }
}

function lexiconHit(stem: string, item: string): boolean {
  if (stem === item) {
    return true;
  }
  if (item.length >= 5 && stem.startsWith(item)) {
    return true;
  }
  return stem.length >= 5 && item.startsWith(stem);
}

function pushPairs(reasons: string[], choices: readonly { id: string; text: string }[]): void {
  for (let left = 0; left < choices.length; left += 1) {
    for (let right = left + 1; right < choices.length; right += 1) {
      const a = choices[left];
      const b = choices[right];
      if (!a || !b) {
        continue;
      }
      if (normalizeRu(a.text) === normalizeRu(b.text)) {
        reasons.push(`выборы ${a.id} и ${b.id} совпали`);
        continue;
      }
      const signA = signatureOf(a.text);
      if (signA.length > 0 && signA === signatureOf(b.text)) {
        reasons.push(`выборы ${a.id} и ${b.id} пересказ`);
      }
    }
  }
}

function orderLikeSource(payload: VariantPayload, source: ValidateSource): VariantPayload {
  const texts = new Map(payload.choices.map((choice) => [choice.id, choice.text]));
  return {
    text: payload.text,
    choices: source.choices.map((choice) => ({
      id: choice.id,
      text: texts.get(choice.id) ?? '',
    })),
  };
}

function bundle(text: string, choices: readonly { text: string }[]): string {
  return [text, ...choices.map((choice) => choice.text)].join('\n');
}

function sameIdSet(expected: readonly string[], got: readonly string[]): boolean {
  if (expected.length !== got.length) {
    return false;
  }
  const pending = new Set(expected);
  for (const id of got) {
    if (!pending.delete(id)) {
      return false;
    }
  }
  return pending.size === 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function sameKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
}
