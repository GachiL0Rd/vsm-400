import type { LlmMessage } from './provider';
import type { VariantPayload } from './validate-variant';
import { unwrapJson } from './validate-variant';

export const JUDGE_SCHEMA_NAME = 'scenario_text_judge';

export const SITUATION_CHECK_ID = 'text';

export const JUDGE_SYSTEM = [
  'Ты проверяешь, сохранил ли перефраз смысл учебного узла проводника.',
  'Стиль не оценивай.',
  'same=true, если действие и адресат те же, отличаются только слова.',
  'Другая формулировка того же действия и того же адресата — same=true, в том числе на медицинском узле: таблетка во рту остаётся таблеткой во рту, доклад начальнику остаётся докладом начальнику.',
  'same=false, только если подменено действие, предмет, место факта или адресат: таблетка стала пилкой, зевать стало топтаться, уже во рту стало в руке, начальник стал водителем, появился новый факт.',
  'Верни checks на каждый id из схемы. id text — ситуация, остальные id — выборы. Ни один id не пропускай.',
  'Верни только JSON.',
].join('\n');

export function reviewStatus(
  autoApprove: boolean,
  judgeEnabled: boolean,
): 'APPROVED' | 'PENDING_REVIEW' {
  if (judgeEnabled && autoApprove) {
    return 'APPROVED';
  }
  return 'PENDING_REVIEW';
}

export function judgeJsonSchema(choiceIds: readonly string[]): Record<string, unknown> {
  const ids = [SITUATION_CHECK_ID, ...choiceIds];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['checks'],
    properties: {
      checks: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'same', 'reason'],
          properties: {
            id: { type: 'string', enum: ids },
            same: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
}

export function buildJudgeMessages(
  source: VariantPayload,
  paraphrase: VariantPayload,
): LlmMessage[] {
  const lines = [
    'Исходная ситуация:',
    source.text.trim(),
    'Перефраз ситуации:',
    paraphrase.text.trim(),
    '',
    'Выборы (id, исходник, перефраз):',
  ];
  for (const choice of source.choices) {
    const next = paraphrase.choices.find((item) => item.id === choice.id);
    lines.push(`- ${choice.id}: ${choice.text.trim()} || ${next?.text.trim() ?? ''}`);
  }
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

export type JudgeParse =
  | { ok: true; passed: boolean; reason: string }
  | { ok: false; reason: string };

export function parseJudge(raw: unknown, choiceIds: readonly string[]): JudgeParse {
  const verdict = readVerdict(raw);
  if (!verdict || hasForeignId(verdict.choices, choiceIds)) {
    return { ok: false, reason: 'судья вернул неразборчивый ответ' };
  }
  const parts = driftParts(verdict.situation, verdict.choices, choiceIds);
  if (parts.length === 0) {
    return { ok: true, passed: true, reason: 'смысл совпал' };
  }
  return { ok: true, passed: false, reason: clip(parts.join('; ')) };
}

type JudgeBit = { same: boolean; reason: string };

function readVerdict(raw: unknown): { situation: JudgeBit; choices: Map<string, JudgeBit> } | null {
  const value = typeof raw === 'string' ? parseJson(unwrapJson(raw)) : raw;
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (Array.isArray(record.checks)) {
    return readChecks(record.checks);
  }
  const situation = readBit(asRecord(record.situation));
  if (!situation || !Array.isArray(record.choices)) {
    return null;
  }
  const choices = readChoiceMap(record.choices);
  if (!choices) {
    return null;
  }
  return { situation, choices };
}

function readChecks(
  items: readonly unknown[],
): { situation: JudgeBit; choices: Map<string, JudgeBit> } | null {
  let situation: JudgeBit | null = null;
  const choices = new Map<string, JudgeBit>();
  for (const item of items) {
    const choice = asRecord(item);
    const bit = readBit(choice);
    if (!choice || typeof choice.id !== 'string' || !bit) {
      return null;
    }
    if (choice.id === SITUATION_CHECK_ID) {
      if (situation) {
        return null;
      }
      situation = bit;
      continue;
    }
    if (choices.has(choice.id)) {
      return null;
    }
    choices.set(choice.id, bit);
  }
  if (!situation) {
    return null;
  }
  return { situation, choices };
}

function readChoiceMap(items: readonly unknown[]): Map<string, JudgeBit> | null {
  const choices = new Map<string, JudgeBit>();
  for (const item of items) {
    const choice = asRecord(item);
    const bit = readBit(choice);
    if (!choice || typeof choice.id !== 'string' || !bit || choices.has(choice.id)) {
      return null;
    }
    choices.set(choice.id, bit);
  }
  return choices;
}

function readBit(record: Record<string, unknown> | null): JudgeBit | null {
  if (!record) {
    return null;
  }
  const same = asBool(record.same);
  const reason = asText(record.reason);
  if (same === null || reason === null) {
    return null;
  }
  return { same, reason };
}

function driftParts(
  situation: JudgeBit,
  choices: Map<string, JudgeBit>,
  choiceIds: readonly string[],
): string[] {
  const parts: string[] = [];
  if (!situation.same) {
    parts.push(`ситуация: ${situation.reason || 'смысл другой'}`);
  }
  for (const id of choiceIds) {
    const choice = choices.get(id);
    if (!choice) {
      parts.push(`выбор ${id}: нет в ответе судьи`);
    } else if (!choice.same) {
      parts.push(`${id}: ${choice.reason || 'смысл другой'}`);
    }
  }
  return parts;
}

function hasForeignId(choices: Map<string, JudgeBit>, choiceIds: readonly string[]): boolean {
  for (const id of choices.keys()) {
    if (!choiceIds.includes(id)) {
      return true;
    }
  }
  return false;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function clip(reason: string): string {
  if (reason.length <= 500) {
    return reason;
  }
  return `${reason.slice(0, 497)}...`;
}
