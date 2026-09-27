import type { LlmMessage } from './provider';
import type { VariantPayload } from './validate-variant';

export const SITUATION_KEY = 'ситуация';

export const JUDGE_SYSTEM = [
  'Ты проверяешь, сохранил ли перефраз смысл учебного узла проводника.',
  'Стиль не оценивай.',
  'Отвечай чистым текстом. Ровно одна строка на пункт.',
  'Ключи — ровно слово «ситуация» и перечисленные id выборов. Каждый ключ один раз.',
  'После ключа ответ только «да» или «нет».',
  'После «нет» поставь тире и причину не длиннее 100 символов.',
  'Без JSON, без markdown, без вступления и заключения.',
  'Форма, ключи бери из задания, не из образца:',
  'ситуация: да',
  '<id>: нет — короткая причина',
  '«да», если действие, адресат и смысл те же и отличаются только слова.',
  '«нет», если изменились действие, адресат или факты, либо добавлены детали.',
].join('\n');

const RETRY_LEAD = [
  'Прошлый ответ не разобран.',
  'Ответь заново и только строками ниже. Где смысл другой, замени «да» на «нет — причина до 100 символов».',
  'Без JSON, без markdown, без вступления и заключения.',
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

export function buildJudgeMessages(
  source: VariantPayload,
  paraphrase: VariantPayload,
  remind = false,
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
  const ids = source.choices.map((choice) => choice.id);
  lines.push('', 'Ключи ответа, каждый ровно один раз:', SITUATION_KEY, ...ids);
  if (remind) {
    lines.push('', RETRY_LEAD, `${SITUATION_KEY}: да`);
    for (const id of ids) {
      lines.push(`${id}: да`);
    }
  }
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

export type JudgeVerdict = {
  same: boolean;
  reason?: string;
};

export type JudgeTextParse = {
  situation: JudgeVerdict | null;
  choices: Record<string, JudgeVerdict>;
  missing: string[];
};

const REASON_LIMIT = 100;
const REJECT_LIMIT = 500;

export function parseJudgeText(raw: string, choiceIds: readonly string[]): JudgeTextParse {
  const expected = new Map<string, string>();
  expected.set(foldKey(SITUATION_KEY), SITUATION_KEY);
  for (const id of choiceIds) {
    expected.set(foldKey(id), id);
  }
  const found = new Map<string, JudgeVerdict>();
  const text = raw.replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }
    const canonical = expected.get(parsed.key);
    if (!canonical || found.has(canonical)) {
      continue;
    }
    found.set(canonical, parsed.verdict);
  }
  const choices: Record<string, JudgeVerdict> = {};
  const missing: string[] = [];
  const situation = found.get(SITUATION_KEY) ?? null;
  if (!situation) {
    missing.push(SITUATION_KEY);
  }
  for (const id of choiceIds) {
    const verdict = found.get(id);
    if (!verdict) {
      missing.push(id);
      continue;
    }
    choices[id] = verdict;
  }
  return { situation, choices, missing };
}

export function judgeOutcome(parsed: JudgeTextParse): { passed: boolean; reason: string } {
  if (parsed.missing.length > 0 || !parsed.situation) {
    return { passed: false, reason: 'judge-unparsed' };
  }
  const parts: string[] = [];
  if (!parsed.situation.same) {
    parts.push(rejectLine(SITUATION_KEY, parsed.situation.reason));
  }
  for (const [id, verdict] of Object.entries(parsed.choices)) {
    if (!verdict.same) {
      parts.push(rejectLine(id, verdict.reason));
    }
  }
  if (parts.length === 0) {
    return { passed: true, reason: 'смысл совпал' };
  }
  return { passed: false, reason: clip(parts.join('; '), REJECT_LIMIT) };
}

function rejectLine(id: string, reason: string | undefined): string {
  const text = reason && reason.trim().length > 0 ? reason.trim() : 'смысл другой';
  return `judge: ${id}: ${text}`;
}

function parseLine(line: string): { key: string; verdict: JudgeVerdict } | null {
  const cleaned = stripNoise(line);
  if (!cleaned) {
    return null;
  }
  const split = splitKeyValue(cleaned);
  if (!split) {
    return null;
  }
  const key = foldKey(stripQuotes(split.key));
  if (!key) {
    return null;
  }
  const verdict = parseVerdict(split.value);
  if (!verdict) {
    return null;
  }
  return { key, verdict };
}

function stripNoise(line: string): string {
  let text = line.replace(/\u00a0/g, ' ').trim();
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(?:[-*]|\d+[.)])\s*/, '').trim();
  }
  return text.replace(/\*/g, '').trim();
}

// Дефис внутри id не режем: разделитель — двоеточие, тире или « - ».
function splitKeyValue(line: string): { key: string; value: string } | null {
  const marks: { at: number; size: number }[] = [];
  const colon = line.indexOf(':');
  if (colon >= 0) {
    marks.push({ at: colon, size: 1 });
  }
  const em = line.indexOf('—');
  if (em >= 0) {
    marks.push({ at: em, size: 1 });
  }
  const en = line.indexOf('–');
  if (en >= 0) {
    marks.push({ at: en, size: 1 });
  }
  const spaced = line.indexOf(' - ');
  if (spaced >= 0) {
    marks.push({ at: spaced, size: 3 });
  }
  if (marks.length === 0) {
    return null;
  }
  marks.sort((left, right) => left.at - right.at);
  const mark = marks[0];
  if (!mark) {
    return null;
  }
  return {
    key: line.slice(0, mark.at),
    value: line.slice(mark.at + mark.size),
  };
}

function parseVerdict(value: string): JudgeVerdict | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const token = match[1] ?? '';
  const word = firstWord(token);
  if (word === 'да') {
    return { same: true };
  }
  if (word === 'нет') {
    const reason = clipReason(`${gluedTail(token)}${match[2] ?? ''}`);
    return reason ? { same: false, reason } : { same: false };
  }
  return null;
}

function firstWord(token: string): string {
  const match = foldKey(token).match(/[^a-zа-я]*([a-zа-я]+)/);
  return match?.[1] ?? '';
}

function gluedTail(token: string): string {
  const match = foldKey(token).match(/[^a-zа-я]*[a-zа-я]+([\s\S]*)/);
  return match?.[1] ?? '';
}

function clipReason(tail: string): string | undefined {
  const cleaned = stripQuotes(tail.replace(/^[\s—–:,!.?;"'«»„“-]+/, '').trim());
  if (!cleaned) {
    return undefined;
  }
  return clip(cleaned, REASON_LIMIT);
}

function stripQuotes(value: string): string {
  return value
    .trim()
    .replace(/^["'«„“]+/, '')
    .replace(/["'»“”]+$/, '')
    .trim();
}

function foldKey(value: string): string {
  return value.replace(/Ё/g, 'е').replace(/ё/g, 'е').toLowerCase().trim();
}

function clip(reason: string, limit: number): string {
  if (reason.length <= limit) {
    return reason;
  }
  return reason.slice(0, limit);
}
