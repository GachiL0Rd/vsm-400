import type { LlmMessage } from './provider';

/** Меняется, когда меняется инструкция. Пул хранит версию рядом с текстом. */
export const PROMPT_VERSION = '2026-09-27.2';

/** Бенч 2026-09-27: 256 хватает на узел из трёх коротких реплик. */
export const LLM_MAX_TOKENS = 256;
export const SCHEMA_NAME = 'scenario_text_variant';
export const TEXT_LIMIT = 160;

export const DEFAULT_PERSONA = 'говорит спокойно и по делу';

/**
 * Текст из llm-bench.md: два правила про подмену действия и должности
 * добавлены после прогона, где таблетка стала пилкой, а зевота — топтанием.
 */
export const SYSTEM_PROMPT = [
  'Ты редактор учебных сценариев тренажёра проводника высокоскоростного поезда.',
  'Перефразируй реплику ситуации и тексты вариантов ответа на живой разговорный русский.',
  'Правила:',
  '- Сохрани смысл каждого варианта, факты и последствия. Не добавляй новых фактов и действий.',
  '- Не меняй конкретное действие и место факта: зевать остаётся зевотой, приоткрыть дверь остаётся приоткрыванием, уже во рту не становится в руке.',
  '- Не подменяй должность: начальник поезда не водитель, не машинист и не диспетчер, если в исходнике этого нет.',
  '- Не добавляй чисел, имён людей, названий лекарств, диагнозов и латиницы, если их не было в исходнике.',
  '- Сохрани якоря смысла. Допустима другая форма того же слова.',
  '- Не меняй id вариантов и их число. Не объединяй и не пропускай варианты.',
  '- Не копируй формулировки дословно. Варианты не должны повторять друг друга.',
  '- Если в задании есть блок «Не повторяй эти формулировки», не пересказывай их.',
  '- Каждый text не длиннее 160 символов. Без канцелярита и без текста вне JSON.',
  '- Персона пассажира в задании задаёт только тон реплики ситуации.',
  'Верни только JSON: {"text":"...","choices":[{"id":"...","text":"..."}]}.',
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
  avoid?: readonly { text: string; choices: readonly PromptChoice[] }[];
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
    ...avoidLines(input.avoid ?? []),
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

function avoidLines(
  samples: readonly { text: string; choices: readonly PromptChoice[] }[],
): string[] {
  if (samples.length === 0) {
    return [];
  }
  const lines = ['', 'Не повторяй эти формулировки:'];
  samples.forEach((sample, index) => {
    const choices = sample.choices
      .map((choice) => `${choice.id}: ${choice.text.trim()}`)
      .join(' | ');
    lines.push(`${index + 1}. ${sample.text.trim()} | ${choices}`);
  });
  return lines;
}
