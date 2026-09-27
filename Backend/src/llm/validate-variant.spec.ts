import { describe, expect, it } from 'vitest';
import { type ValidateSource, validateVariant } from './validate-variant';

const source: ValidateSource = {
  text: 'На скорости свист из тамбура. Пассажир держится за уши.',
  choices: [
    { id: 'radio', text: 'Сразу доложить по связи' },
    { id: 'yawn', text: 'Советовать зевать и глотать' },
    { id: 'walk', text: 'Сначала самому дойти до свиста' },
  ],
  keep: ['свист', 'тамбур', 'уши'],
};

const good = {
  text: 'На ходу из тамбура свистит, пассажир держится за уши.',
  choices: [
    { id: 'walk', text: 'Сперва самому пройти на свист' },
    { id: 'radio', text: 'Немедленно доложить по связи' },
    { id: 'yawn', text: 'Предложить зевать и сглатывать' },
  ],
};

function reasons(raw: unknown, patch?: Partial<ValidateSource>): string[] {
  const result = validateVariant(raw, { ...source, ...patch });
  return result.ok ? [] : result.reasons;
}

describe('validateVariant', () => {
  it('принимает перефраз и выравнивает порядок id', () => {
    const result = validateVariant(good, source);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.payload.choices.map((choice) => choice.id)).toEqual(['radio', 'yawn', 'walk']);
  });

  it('снимает ограду json и не путает Ё с е', () => {
    const raw = `\`\`\`json\n${JSON.stringify({
      text: 'Из тамбура СВИСТ, пассажир держится за уши.',
      choices: [
        { id: 'radio', text: 'Срочно доложить по связи' },
        { id: 'yawn', text: 'Предложить зевать и сглатывать' },
        { id: 'walk', text: 'Сперва самому пройти на свист' },
      ],
    })}\n\`\`\``;
    const result = validateVariant(raw, { ...source, keep: ['Свист', 'тамбур', 'Ёжик'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('нет якоря: Ёжик');
    }
    expect(validateVariant(raw, source).ok).toBe(true);
  });

  it('отклоняет битый json и чужую схему', () => {
    expect(reasons('не json')).toEqual(['ответ не JSON']);
    expect(reasons({ text: 'Из тамбура свистит, пассажир держится за уши.', extra: 1 })).toEqual([
      'схема ответа',
    ]);
    expect(reasons({ text: 1, choices: [] })).toEqual(['схема ответа']);
  });

  it('требует тот же набор id', () => {
    expect(
      reasons({
        ...good,
        choices: [
          { id: 'radio', text: 'Немедленно доложить по связи' },
          { id: 'yawn', text: 'Предложить зевать и сглатывать' },
          { id: 'radio', text: 'Ещё раз доложить по связи' },
        ],
      }),
    ).toEqual(['набор id выборов не совпал']);
    expect(
      reasons({
        ...good,
        choices: [
          { id: 'radio', text: 'Немедленно доложить по связи' },
          { id: 'yawn', text: 'Предложить зевать и сглатывать' },
        ],
      }),
    ).toEqual(['набор id выборов не совпал']);
    expect(
      reasons({
        ...good,
        choices: [...good.choices, { id: 'extra', text: 'Позвать кого-нибудь из салона' }],
      }),
    ).toEqual(['набор id выборов не совпал']);
  });

  it('режет пустое и длиннее 160', () => {
    expect(reasons({ ...good, text: '   ' })).toContain('пустой текст: текст ситуации');
    expect(reasons({ ...good, text: `Из тамбура свистит, за уши. ${'а'.repeat(160)}` })).toContain(
      'текст ситуации длиннее 160',
    );
  });

  it('держит якоря и не пускает дословную копию', () => {
    expect(
      reasons({
        text: 'Пассажир молчит у двери и ждёт.',
        choices: [
          { id: 'radio', text: 'Позвать бригадира к людям' },
          { id: 'yawn', text: 'Предложить всем сесть спокойно' },
          { id: 'walk', text: 'Самому пройти вдоль салона' },
        ],
      }),
    ).toEqual(expect.arrayContaining(['нет якоря: свист', 'нет якоря: тамбур', 'нет якоря: уши']));
    expect(reasons({ ...good, text: source.text })).toContain('текст ситуации совпал с исходником');
    const copied = {
      ...good,
      choices: source.choices.map((choice) => ({ ...choice })),
    };
    expect(reasons(copied)).toEqual(
      expect.arrayContaining([
        'выбор radio совпал с исходником',
        'выбор yawn совпал с исходником',
        'выбор walk совпал с исходником',
      ]),
    );
  });

  it('не пускает новые цифры, латиницу, имена, лекарства и факты', () => {
    expect(
      reasons({ ...good, text: 'Из тамбура свистит уже 12 минут, пассажир держится за уши.' }),
    ).toContain('новая цифра: 12');
    const withTen = validateVariant(
      {
        ...good,
        text: 'Из тамбура свистит, пассажир держится за уши.',
        choices: good.choices.map((choice) =>
          choice.id === 'radio'
            ? { ...choice, text: 'Доложить по связи, рядом 10 человек' }
            : choice,
        ),
      },
      { ...source, text: 'До остановки 10 минут. Свист из тамбура, пассажир держится за уши.' },
    );
    expect(withTen.ok).toBe(true);

    expect(
      reasons({ ...good, text: 'Из тамбура свистит, пассажир держится за уши, call help.' }),
    ).toContain('латиница');
    expect(reasons({ ...good, text: 'Из тамбура свистит, Мария держится за уши.' })).toContain(
      'имя: мария',
    );
    expect(
      reasons({
        ...good,
        text: 'Из тамбура свистит, пассажир просит парацетамол и держится за уши.',
      }),
    ).toContain('лекарство: парацетамол');
    const pillSource: ValidateSource = {
      ...source,
      text: 'Пассажир показывает на таблетку. Свист из тамбура, держится за уши.',
    };
    expect(
      validateVariant(
        { ...good, text: 'Пассажир снова показывает таблетку. Свист из тамбура, держится за уши.' },
        pillSource,
      ).ok,
    ).toBe(true);
    expect(
      reasons({ ...good, text: 'Из тамбура свистит, пассажир держится за уши и зовёт полицию.' }),
    ).toContain('новый факт: полицию');
    expect(
      reasons({
        ...good,
        text: 'На скорости свистит из тамбура, пассажир держится за уши.',
      }).includes('новый факт: скорости'),
    ).toBe(false);
  });

  it('не пускает одинаковые и пересказанные выборы', () => {
    const same = good.choices.map((choice) =>
      choice.id === 'walk' ? { ...choice, text: 'Немедленно доложить по связи' } : choice,
    );
    expect(reasons({ ...good, choices: same })).toContain('выборы radio и walk совпали');

    const retold = good.choices.map((choice) =>
      choice.id === 'walk' ? { ...choice, text: 'По связи доложить немедленно' } : choice,
    );
    expect(reasons({ ...good, choices: retold })).toContain('выборы radio и walk пересказ');
  });
});
