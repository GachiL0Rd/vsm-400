import type { LlmMessage } from './provider';

/** Меняется, когда меняется инструкция. Пул хранит версию рядом с текстом. */
export const PROMPT_VERSION = '2026-09-27.1';

export const LLM_TEMPERATURE = 0.8;
export const LLM_MAX_TOKENS = 320;
export const SCHEMA_NAME = 'scenario_text_variant';
export const TEXT_LIMIT = 160;

export const DEFAULT_PERSONA = 'говорит спокойно и по делу';

/**
 * Отчёта llm-bench.md не было: инструкция собрана по §14.
 * Мало токенов специально: локальная модель на 4096 контекста и ~6 ток/с.
 */
export const SYSTEM_PROMPT = [
  'Ты редактор учебных сценариев проводника РЖД и ВСМ.',
  'Перефразируй реплику ситуации и тексты вариантов ответа. Смысл и логика те же.',
  'Верни только JSON: {"text": string, "choices": [{"id": string, "text": string}]}.',
  'id скопируй из задания, без новых и без пропусков.',
  'Каждый text — живой разговорный русский, не длиннее 160 символов.',
  'Сохрани якоря из задания: та же основа слова, регистр и «ё» не важны.',
  'Не добавляй фактов, действий, мест, цифр, лекарств, имён людей и латинских букв.',
  'Не копируй исходные фразы дословно.',
  'Варианты — разные действия, не пересказ друг друга.',
  'Персона задаёт только тон. Пояснений вне JSON не пиши.',
].join('\n');

export type PromptChoice = {
  id: string;
  text: string;
};

export function variantJsonSchema(choiceIds: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'choices'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: TEXT_LIMIT },
      choices: {
        type: 'array',
        minItems: choiceIds.length,
        maxItems: choiceIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'text'],
          properties: {
            id: { type: 'string', enum: [...choiceIds] },
            text: { type: 'string', minLength: 1, maxLength: TEXT_LIMIT },
          },
        },
      },
    },
  };
}

export function buildMessages(input: {
  persona: string;
  keep: readonly string[];
  forbid: readonly string[];
  text: string;
  choices: readonly PromptChoice[];
}): LlmMessage[] {
  const persona = input.persona.trim().length > 0 ? input.persona.trim() : DEFAULT_PERSONA;
  const anchors = input.keep.length > 0 ? input.keep.join(', ') : 'нет';
  const bans = input.forbid.length > 0 ? input.forbid.join(', ') : 'нет';
  const choiceLines = input.choices.map((choice) => `- ${choice.id}: ${choice.text.trim()}`);
  const user = [
    `Персона пассажира: ${persona}`,
    `Якоря, которые уже есть в исходнике и должны остаться: ${anchors}`,
    `Не добавлять: ${bans}`,
    '',
    'Ситуация:',
    input.text.trim(),
    '',
    'Варианты, id не менять:',
    ...choiceLines,
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
