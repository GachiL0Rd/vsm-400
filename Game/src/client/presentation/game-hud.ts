import type { PublicGameState } from '../../common';
import type { InteractionController } from '../input/interaction-controller';
import type { PresentationState, PresentationStore } from './presentation-store';

const DEFAULT_TARGET = 'Кликните по пассажиру или объекту. Клик по полу задаёт маршрут.';

/** Reference HUD layout, fed exclusively by the current public projection. */
export class GameHud {
  private readonly root = document.createElement('aside');
  private readonly status = document.createElement('div');
  private readonly clock = document.createElement('div');
  private readonly metrics = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly summary = document.createElement('summary');
  private readonly phase = document.createElement('p');
  private readonly observations = document.createElement('div');
  private readonly heldItem = document.createElement('div');
  private readonly target = document.createElement('div');
  private readonly detail = document.createElement('section');
  private readonly dashboard = document.createElement('details');
  private readonly resultLink = document.createElement('a');
  private readonly scales: HTMLButtonElement[] = [];
  private readonly unsubscribe: () => void;
  private wasNarrow = window.innerWidth <= 760;
  private phaseText = 'Ожидание сервера';
  private timeScale = 1;
  private readonly onResize = (): void => {
    const narrow = window.innerWidth <= 760;
    if (narrow !== this.wasNarrow) this.dashboard.open = !narrow;
    this.wasNarrow = narrow;
  };

  constructor(
    parent: HTMLElement,
    store: PresentationStore,
    interactions: InteractionController,
    downloadLog?: () => void,
  ) {
    this.root.className = 'game-panel';
    this.root.setAttribute('aria-label', 'Игровое состояние');
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h1');
    title.textContent = 'ВСМ · Смена 04';
    this.status.className = 'connection-state';
    header.append(title, this.status);
    this.clock.className = 'clock';
    this.metrics.className = 'metrics';
    this.message.className = 'message';
    this.dashboard.className = 'dashboard';
    this.dashboard.open = !this.wasNarrow;
    this.summary.className = 'dashboard-summary';
    this.dashboard.append(this.summary);

    const phaseSection = section('Задачи');
    this.phase.className = 'muted';
    phaseSection.append(this.phase);
    const observationSection = section('Наблюдения');
    this.observations.className = 'observation-list';
    observationSection.append(this.observations);
    const itemSection = section('Предмет');
    this.heldItem.className = 'item-state';
    itemSection.append(this.heldItem);
    const footer = document.createElement('div');
    footer.className = 'footer-actions';
    const speedLabel = document.createElement('span');
    speedLabel.className = 'muted';
    speedLabel.textContent = 'Скорость времени';
    footer.append(speedLabel);
    for (const scale of [1, 2, 4] as const) {
      const button = document.createElement('button');
      button.className = 'game-button speed-button';
      button.type = 'button';
      button.textContent = `×${scale}`;
      button.setAttribute('aria-label', `Скорость времени ${scale}x`);
      button.addEventListener('click', () => interactions.setTimeScale(scale));
      footer.append(button);
      this.scales.push(button);
    }
    if (downloadLog !== undefined) {
      const logButton = document.createElement('button');
      logButton.className = 'game-button';
      logButton.type = 'button';
      logButton.textContent = 'Скачать лог';
      logButton.addEventListener('click', downloadLog);
      footer.append(logButton);
    }
    this.resultLink.className = 'result-link';
    this.resultLink.textContent = 'Открыть результат смены';
    this.resultLink.hidden = true;
    footer.append(this.resultLink);
    this.dashboard.append(phaseSection, observationSection, itemSection, footer);
    this.root.append(header, this.clock, this.metrics, this.message, this.dashboard);

    this.detail.className = 'detail-panel';
    this.target.className = 'detail-target';
    this.target.textContent = DEFAULT_TARGET;
    this.detail.append(this.target);
    parent.append(this.root, this.detail);
    window.addEventListener('resize', this.onResize);
    this.unsubscribe = store.subscribe((state) => this.render(state));
  }

  setVisualTime(timeUs: number): void {
    this.clock.textContent = `${this.phaseText} · ${(timeUs / 1_000_000).toFixed(1)} с · ×${this.timeScale}`;
  }

  setTarget(text: string | null): void {
    this.target.textContent = text ?? DEFAULT_TARGET;
  }

  destroy(): void {
    this.unsubscribe();
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.detail.remove();
  }

  private render(state: Readonly<PresentationState>): void {
    const publicState = state.publicState;
    const statusLabels: Record<PresentationState['connection'], string> = {
      connecting: 'Подключение',
      connected: 'Связь есть',
      disconnected: 'Нет связи',
      reconnecting: 'Переподключение',
      error: 'Ошибка связи',
    };
    this.status.textContent = `● ${statusLabels[state.connection]}`;
    this.status.dataset.state = state.connection;
    this.phaseText = publicState === null ? 'Ожидание' : phaseLabel(publicState.phase);
    this.timeScale = publicState?.clock.timeScale ?? 1;
    this.setVisualTime(publicState?.timeUs ?? 0);
    this.metrics.textContent =
      publicState === null
        ? 'Данные игрового сервера загружаются'
        : `Пассажиры ${publicState.entities.filter((entity) => entity.kind === 'passenger').length} · Объекты ${publicState.world.objects.length} · ${modeLabel(publicState.mode.kind)}`;
    this.message.textContent =
      presentationMessage(state) ||
      (publicState === null
        ? 'Подключение к игровому серверу…'
        : 'Выберите точку или объект в вагоне.');
    this.summary.textContent =
      publicState === null
        ? 'Задачи · Наблюдения · Действия'
        : `Обстановка · Сигналы ${state.lastPresentationEvent === null ? 0 : 1} · Действия ${state.currentOffer?.actions.length ?? 0}`;
    this.phase.textContent =
      publicState === null
        ? 'Ожидание состояния сервера.'
        : `${phaseLabel(publicState.phase)}. Доступные действия появятся после выбора объекта или пассажира.`;
    this.renderObservations(state);
    const held = publicState?.entities.find((entity) => entity.kind === 'player')?.heldItem;
    this.heldItem.textContent =
      held === undefined ? 'В руках: пусто' : `В руках: ${heldItemName(held.visualId)}`;
    this.renderControls(state);
  }

  private renderControls(state: Readonly<PresentationState>): void {
    const publicState = state.publicState;
    const active =
      state.connection === 'connected' &&
      publicState !== null &&
      publicState.mode.kind !== 'replay' &&
      publicState.phase.kind !== 'finished';
    for (const [index, button] of this.scales.entries()) {
      button.disabled = !active;
      button.dataset.active = publicState?.clock.timeScale === [1, 2, 4][index] ? 'true' : 'false';
    }
    const redirect =
      state.sessionState?.state === 'finished' ? state.sessionState.redirectUrl : undefined;
    this.resultLink.hidden = redirect === undefined;
    if (redirect !== undefined) this.resultLink.href = redirect;
  }

  private renderObservations(state: Readonly<PresentationState>): void {
    this.observations.replaceChildren();
    const event = state.lastPresentationEvent?.event;
    const text = event === undefined ? null : presentationEventText(event);
    if (text === null || text === '') {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Наблюдений пока нет.';
      this.observations.append(empty);
      return;
    }
    const card = document.createElement('p');
    card.className = 'cue';
    card.textContent = text;
    this.observations.append(card);
  }
}

function section(heading: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'panel-section';
  const title = document.createElement('h2');
  title.textContent = heading;
  root.append(title);
  return root;
}

function presentationMessage(state: Readonly<PresentationState>): string {
  if (state.lastError !== null) return state.lastError.message;
  if (state.lastCommandResult?.status === 'rejected') return state.lastCommandResult.message;
  return '';
}

function presentationEventText(
  event: NonNullable<PresentationState['lastPresentationEvent']>['event'],
): string | null {
  switch (event.kind) {
    case 'hint':
      return event.text ?? 'Подсказка';
    case 'speech':
      return event.visible ? event.text : null;
    case 'notification':
      return event.text;
    case 'achievement-unlocked':
      return `Достижение: ${event.achievementId}`;
    case 'effect':
      return null;
  }
}

function phaseLabel(phase: PublicGameState['phase']): string {
  switch (phase.kind) {
    case 'pre-departure':
      return 'Приёмка вагона';
    case 'origin-stop':
      return 'Посадка';
    case 'travel':
      return 'Поездка';
    case 'stop':
      return `Остановка ${phase.stopIndex + 1}`;
    case 'finished':
      return 'Итог смены';
  }
}

function modeLabel(kind: PublicGameState['mode']['kind']): string {
  switch (kind) {
    case 'live':
      return 'Игра';
    case 'guided':
      return 'Обучение';
    case 'replay':
      return 'Повтор';
  }
}

function heldItemName(visualId: string): string {
  const names: Record<string, string> = {
    'item.acceptance-journal': 'журнал приёмки',
    'item.extinguisher': 'огнетушитель',
    'item.drink': 'напиток',
    'item.food': 'еда',
  };
  return names[visualId] ?? 'предмет';
}
