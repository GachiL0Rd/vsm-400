export const LESSON_IDS = ['aisle', 'call-button', 'accessible-route'] as const;

export type LessonId = (typeof LESSON_IDS)[number];

export type LessonSummary = {
  id: LessonId;
  title: string;
  subtitle: string;
  icon: string;
  source: string;
  skill: string;
};

export const LESSONS: readonly LessonSummary[] = [
  {
    id: 'aisle',
    title: 'Свободный проход',
    subtitle: 'Безопасность и конфликт',
    icon: '🧳',
    source: '«Ситуации на борту», № 14 и 23',
    skill: 'Безопасность',
  },
  {
    id: 'call-button',
    title: 'Кнопка не отвечает',
    subtitle: 'Сервис и эскалация',
    icon: '🔔',
    source: '«Ситуации на борту», № 16; СТО РЖД 03.013',
    skill: 'Сервис',
  },
  {
    id: 'accessible-route',
    title: 'Помощь в пути',
    subtitle: 'Доступность и общение',
    icon: '🤝',
    source: 'СТО РЖД 03.014, разделы 7–8',
    skill: 'Доступность',
  },
];

export type Choice = {
  id: string;
  text: string;
  safety: number;
  loyalty: number;
  feedback: string;
  nextStepId?: string;
  isTimeout?: true;
};

export type Step = {
  id: string;
  speaker: string;
  dialogue: string;
  prompt: string;
  choices: readonly Choice[];
  timeLimitSeconds?: number;
  timeoutChoiceId?: string;
};

export type Scenario = LessonSummary & {
  setting: string;
  briefing: string;
  firstStepId: string;
  steps: readonly Step[];
};

export type Answer = {
  stepId: string;
  choiceId: string;
  text: string;
  safety: number;
  loyalty: number;
  feedback: string;
  isTimeout: boolean;
};

export type Run = {
  scenario: Scenario;
  stepId: string | null;
  safety: number;
  loyalty: number;
  answers: readonly Answer[];
};

function pick<T>(items: readonly T[], random: () => number): T {
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)));
  const item = items[index];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
}

function choice(
  id: string,
  text: string,
  safety: number,
  loyalty: number,
  feedback: string,
  nextStepId?: string,
): Choice {
  return { id, text, safety, loyalty, feedback, ...(nextStepId ? { nextStepId } : {}) };
}

function aisleScenario(
  random: () => number,
): Pick<Scenario, 'setting' | 'briefing' | 'firstStepId' | 'steps'> {
  const car = pick([2, 4, 6], random);
  const complaint = pick(
    [
      'Из-за этой сумки не пройти к выходу. Я уже попросил убрать её, но меня не слушают!',
      'В проходе стоит большой чемодан. Я боюсь, что кто-нибудь о него споткнётся.',
    ],
    random,
  );

  return {
    setting: `Вагон ${car} · проход у выхода`,
    briefing:
      'Багаж загородил проход. Владелец спорит с другим пассажиром. Вам нужно убрать риск и не усилить конфликт.',
    firstStepId: 'notice',
    steps: [
      {
        id: 'notice',
        speaker: 'Пассажир',
        dialogue: complaint,
        prompt: 'С чего начнёте?',
        choices: [
          choice(
            'identify',
            'Поблагодарить за сигнал, найти владельца и предложить место для багажа',
            12,
            8,
            'Вы признали проблему и предложили конкретное безопасное решение.',
            'resistance',
          ),
          choice(
            'scold',
            'Громко потребовать немедленно убрать чемодан',
            3,
            -12,
            'Вы обозначили проблему, но публичный резкий тон усилил спор.',
            'resistance',
          ),
          choice(
            'ignore',
            'Предложить пассажирам разобраться самим',
            -15,
            -10,
            'Проход остался перекрыт, а конфликт — без внимания персонала.',
            'obstruction',
          ),
        ],
      },
      {
        id: 'resistance',
        speaker: 'Владелец багажа',
        dialogue: 'Я ненадолго поставил! Мне больше некуда его убрать.',
        prompt: 'Проход всё ещё закрыт. Как поступите?',
        timeLimitSeconds: 15,
        timeoutChoiceId: 'timeout',
        choices: [
          choice(
            'explain',
            'Спокойно объяснить риск, показать место для багажа и при отказе позвать начальника',
            18,
            8,
            'Вы устраняете риск, предлагаете выход и знаете, когда привлечь начальника поезда.',
          ),
          choice(
            'move',
            'Молча переставить чужой чемодан без разговора',
            5,
            -10,
            'Проход может освободиться, но вы не согласовали действие и не сняли причину конфликта.',
          ),
          choice(
            'wait',
            'Оставить чемодан до ближайшей остановки',
            -18,
            -8,
            'Риск для прохода сохраняется; откладывать решение нельзя.',
          ),
          {
            ...choice(
              'timeout',
              'Время вышло: проход остался перекрыт',
              -20,
              -12,
              'Промедление сохранило препятствие и усилило раздражение пассажиров.',
            ),
            isTimeout: true,
          },
        ],
      },
      {
        id: 'obstruction',
        speaker: 'Пассажир',
        dialogue: 'Ничего не изменилось. Нам всё ещё не пройти!',
        prompt: 'У вас есть шанс исправить ситуацию.',
        timeLimitSeconds: 12,
        timeoutChoiceId: 'timeout',
        choices: [
          choice(
            'recover',
            'Вернуться, найти владельца и помочь освободить проход',
            14,
            5,
            'Вы исправили первоначальную ошибку и занялись причиной жалобы.',
          ),
          choice(
            'dismiss',
            'Повторить, что это спор между пассажирами',
            -14,
            -10,
            'Ответственность за безопасный проход снова осталась без решения.',
          ),
          {
            ...choice(
              'timeout',
              'Время вышло: препятствие осталось',
              -20,
              -12,
              'Время прошло, а риск и конфликт сохранились.',
            ),
            isTimeout: true,
          },
        ],
      },
    ],
  };
}

function callButtonScenario(
  random: () => number,
): Pick<Scenario, 'setting' | 'briefing' | 'firstStepId' | 'steps'> {
  const seat = pick([12, 18, 24], random);
  return {
    setting: `Вагон 3 · место ${seat}`,
    briefing:
      'Пассажир сообщает о неработающей кнопке вызова. Проблему нужно признать, проверить и передать ответственным.',
    firstStepId: 'complaint',
    steps: [
      {
        id: 'complaint',
        speaker: 'Пассажир',
        dialogue: pick(
          [
            'Я нажимаю кнопку вызова, но никто не приходит. Она вообще работает?',
            // biome-ignore lint/security/noSecrets: This is dialogue text, not a credential.
            'Кнопка не работает. Как позвать сотрудника?',
          ],
          random,
        ),
        prompt: 'Как ответите?',
        choices: [
          choice(
            'acknowledge',
            'Извиниться, проверить кнопку и сообщить, как обратиться за помощью сейчас',
            5,
            12,
            'Вы признали неудобство и предложили работающий способ связи.',
            'follow-up',
          ),
          choice(
            'dismiss',
            'Сказать, что пассажир, вероятно, неправильно нажимает кнопку',
            -6,
            -12,
            'Предположение без проверки обесценило обращение и оставило неисправность.',
            'follow-up',
          ),
          choice(
            'promise',
            'Пообещать, что кнопка заработает через минуту',
            0,
            2,
            'Вы дали обещание до проверки и без участия технического специалиста.',
            'follow-up',
          ),
        ],
      },
      {
        id: 'follow-up',
        speaker: 'Ситуация',
        dialogue: 'Кнопка действительно не реагирует. Пассажир ждёт вашего решения.',
        prompt: 'Что сделаете дальше?',
        choices: [
          choice(
            'report',
            'Сообщить начальнику поезда и бортинженеру, предложить доступную альтернативу',
            10,
            12,
            'О неисправности сообщили. У пассажира остался способ связи.',
          ),
          choice(
            'repair',
            'Самостоятельно разобрать панель возле кресла',
            -12,
            -8,
            'Техническую неисправность нужно передать специалисту, не вмешиваясь в оборудование.',
          ),
          choice(
            'leave',
            'Пообещать вернуться позже и продолжить обход',
            -8,
            -10,
            'Проблема осталась без передачи ответственным и понятной альтернативы для пассажира.',
          ),
        ],
      },
    ],
  };
}

function accessibleRouteScenario(
  random: () => number,
): Pick<Scenario, 'setting' | 'briefing' | 'firstStepId' | 'steps'> {
  const car = pick([2, 5], random);
  return {
    setting: `Вагон ${car} · после посадки`,
    briefing:
      'Пассажиру с нарушением зрения нужна помощь, чтобы найти место. Уточните его потребность и учитывайте препятствия.',
    firstStepId: 'request',
    steps: [
      {
        id: 'request',
        speaker: 'Пассажир',
        dialogue: pick(
          [
            'Помогите, пожалуйста, найти моё место. Мне трудно сориентироваться в вагоне.',
            'Я не вижу номер ряда. Подскажете, как пройти к моему месту?',
          ],
          random,
        ),
        prompt: 'Как предложите помощь?',
        choices: [
          choice(
            'ask',
            'Спросить, какая помощь удобна, описать путь и предложить сопровождение',
            8,
            12,
            'Вы уточнили потребность и дали пассажиру возможность выбрать способ помощи.',
            'barrier',
          ),
          choice(
            'grab',
            'Взять пассажира под руку без предупреждения и быстро повести',
            -8,
            -12,
            'Помощь без согласования может быть неудобной и не учитывает предпочтения пассажира.',
            'barrier',
          ),
          choice(
            'point',
            'Указать рукой в конец вагона и вернуться к работе',
            -4,
            -10,
            'Жест не даёт нужной информации пассажиру с нарушением зрения.',
            'barrier',
          ),
        ],
      },
      {
        id: 'barrier',
        speaker: 'Ситуация',
        dialogue: 'По пути к месту проход частично перекрыт сумкой.',
        prompt: 'Что сделаете?',
        choices: [
          choice(
            'clear',
            'Предупредить о препятствии, помочь освободить проход и продолжить путь',
            14,
            8,
            'Вы сообщили об обстановке и обеспечили более безопасный доступный маршрут.',
          ),
          choice(
            'squeeze',
            'Провести пассажира мимо сумки, не упоминая её',
            -12,
            -8,
            'Скрытое препятствие увеличивает риск и лишает пассажира важной информации.',
          ),
          choice(
            'abandon',
            'Оставить пассажира ждать, не объяснив причину',
            -10,
            -12,
            'Пассажир остался без информации и понятного следующего шага.',
          ),
        ],
      },
    ],
  };
}

/** Builds a local variation of a curated decision graph; no network or AI service is involved. */
export function generateScenario(id: LessonId, random: () => number = Math.random): Scenario {
  const summary = LESSONS.find((lesson) => lesson.id === id);
  if (!summary) throw new Error(`Unknown lesson: ${id}`);

  const content =
    id === 'aisle'
      ? aisleScenario(random)
      : id === 'call-button'
        ? callButtonScenario(random)
        : accessibleRouteScenario(random);

  return { ...summary, ...content };
}

export function createRun(scenario: Scenario): Run {
  return { scenario, stepId: scenario.firstStepId, safety: 60, loyalty: 60, answers: [] };
}

export function currentStep(run: Run): Step | null {
  if (run.stepId === null) return null;
  const step = run.scenario.steps.find((candidate) => candidate.id === run.stepId);
  if (!step) throw new Error(`Unknown step: ${run.stepId}`);
  return step;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function applyChoice(run: Run, choiceId: string): Run {
  const step = currentStep(run);
  if (!step) throw new Error('Lesson already finished');
  const selected = step.choices.find((option) => option.id === choiceId);
  if (!selected) throw new Error(`Unknown choice: ${choiceId}`);
  if (selected.isTimeout && step.timeoutChoiceId !== choiceId) {
    throw new Error('Timeout choice does not match step');
  }

  const answer: Answer = {
    stepId: step.id,
    choiceId,
    text: selected.text,
    safety: selected.safety,
    loyalty: selected.loyalty,
    feedback: selected.feedback,
    isTimeout: selected.isTimeout === true,
  };

  return {
    ...run,
    stepId: selected.nextStepId ?? null,
    safety: clampScore(run.safety + selected.safety),
    loyalty: clampScore(run.loyalty + selected.loyalty),
    answers: [...run.answers, answer],
  };
}
