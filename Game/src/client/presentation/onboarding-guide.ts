export const GUIDE_STORAGE_KEY = 'vsm.guide.seen';

export type GuideTargetId = 'tasks' | 'hint' | 'feed' | 'items' | 'time';

export interface GuideStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly spotlight: readonly GuideTargetId[];
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'goal',
    title: 'Цель смены',
    body: 'Приёмка вагона → посадка → рейс. Оценку ставят за безопасность и сервис.',
    spotlight: ['tasks'],
  },
  {
    id: 'controls',
    title: 'Управление',
    body: 'Клик или тап по полу — идти. По пассажиру или объекту — список действий.',
    spotlight: ['hint'],
  },
  {
    id: 'hud',
    title: 'Где смотреть',
    // biome-ignore lint/security/noSecrets: player-facing Russian copy
    body: '«Задачи» — цель. «Наблюдения» — реплики. «События» — уведомления. «Предметы» — что в руках.',
    spotlight: ['tasks', 'feed', 'items'],
  },
  {
    id: 'time',
    title: 'Скорость времени',
    body: 'Кнопки ×1, ×2 и ×4 меняют скорость игрового времени.',
    spotlight: ['time'],
  },
  {
    id: 'first',
    title: 'Первый шаг',
    body: 'Подойдите к журналу приёмки на перроне и возьмите его.',
    spotlight: [],
  },
];

export interface GuideState {
  readonly open: boolean;
  readonly index: number;
}

export function readGuideSeen(storage: Pick<Storage, 'getItem'> | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(GUIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGuideSeen(storage: Pick<Storage, 'setItem'> | null): void {
  if (storage === null) return;
  try {
    storage.setItem(GUIDE_STORAGE_KEY, '1');
  } catch {
    // Private mode and blocked storage still let the overlay close.
  }
}

export function initialGuideState(seen: boolean): GuideState {
  return { open: !seen, index: 0 };
}

export function advanceGuide(state: GuideState): GuideState {
  if (!state.open) return state;
  if (state.index >= GUIDE_STEPS.length - 1) return { open: false, index: 0 };
  return { open: true, index: state.index + 1 };
}

export function rewindGuide(state: GuideState): GuideState {
  if (!state.open) return state;
  return { open: true, index: Math.max(0, state.index - 1) };
}

export function closeGuide(): GuideState {
  return { open: false, index: 0 };
}

export function reopenGuide(): GuideState {
  return { open: true, index: 0 };
}

export interface OnboardingGuideOptions {
  readonly parent: HTMLElement;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly targets: ReadonlyMap<GuideTargetId, HTMLElement>;
}

/** Client-only first-run overlay. It does not send a pause to the server. */
export class OnboardingGuide {
  private readonly scrim = document.createElement('div');
  private readonly card = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly progress = document.createElement('p');
  private readonly body = document.createElement('p');
  private readonly back = document.createElement('button');
  private readonly next = document.createElement('button');
  private readonly done = document.createElement('button');
  private state: GuideState;

  constructor(private readonly options: OnboardingGuideOptions) {
    this.scrim.className = 'hud-guide__scrim';
    this.card.className = 'hud-guide';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'hud-guide-title');
    this.title.id = 'hud-guide-title';
    this.title.className = 'hud-guide__title';
    this.progress.className = 'hud-guide__progress';
    this.body.className = 'hud-guide__body';
    const actions = document.createElement('div');
    actions.className = 'hud-guide__actions';
    this.back.type = 'button';
    this.back.className = 'hud-guide__button';
    this.back.textContent = 'Назад';
    this.next.type = 'button';
    this.next.className = 'hud-guide__button';
    this.next.textContent = 'Далее';
    this.done.type = 'button';
    this.done.className = 'hud-guide__button hud-guide__button--primary';
    this.done.textContent = 'Понятно, начать';
    this.back.addEventListener('click', () => this.renderState(rewindGuide(this.state)));
    this.next.addEventListener('click', () => this.renderState(advanceGuide(this.state)));
    this.done.addEventListener('click', () => this.finish());
    actions.append(this.back, this.next, this.done);
    this.card.append(this.progress, this.title, this.body, actions);
    options.parent.append(this.scrim, this.card);
    window.addEventListener('keydown', this.onKey);
    this.state = initialGuideState(readGuideSeen(options.storage));
    this.paint();
  }

  open(): void {
    this.renderState(reopenGuide());
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.clearSpotlight();
    this.scrim.remove();
    this.card.remove();
  }

  private finish(): void {
    writeGuideSeen(this.options.storage);
    this.renderState(closeGuide());
  }

  private renderState(state: GuideState): void {
    const closing = this.state.open && !state.open;
    this.state = state;
    if (closing) writeGuideSeen(this.options.storage);
    this.paint();
  }

  private paint(): void {
    const hidden = !this.state.open;
    this.scrim.hidden = hidden;
    this.card.hidden = hidden;
    this.clearSpotlight();
    if (hidden) return;
    const step = GUIDE_STEPS[this.state.index] ?? GUIDE_STEPS[0];
    if (step === undefined) return;
    this.progress.textContent = `${this.state.index + 1} / ${GUIDE_STEPS.length}`;
    this.title.textContent = step.title;
    this.body.textContent = step.body;
    this.back.disabled = this.state.index === 0;
    this.next.hidden = this.state.index >= GUIDE_STEPS.length - 1;
    for (const id of step.spotlight) {
      this.options.targets.get(id)?.classList.add('is-guide-target');
    }
    const focus = this.next.hidden ? this.done : this.next;
    focus.focus();
  }

  private clearSpotlight(): void {
    for (const element of this.options.targets.values()) {
      element.classList.remove('is-guide-target');
    }
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.state.open || event.repeat) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finish();
      return;
    }
    if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    this.renderState(advanceGuide(this.state));
  };
}

export function availableLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
