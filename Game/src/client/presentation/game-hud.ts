import extinguisherUrl from '../../../assets/ui/extinguisher.png';
import type { InteractionController } from '../input/interaction-controller';
import { ActionOfferOverlay } from './action-offer-overlay';
import { ConnectionStatus } from './connection-status';
import { availableLocalStorage, type GuideTargetId, OnboardingGuide } from './onboarding-guide';
import {
  formatSimClock,
  heldItemName,
  metricsLine,
  phaseLabel,
  phaseObjective,
  REDIRECT_DELAY_MS,
} from './presentation-copy';
import type { PresentationState, PresentationStore, PresentationToast } from './presentation-store';

const DEFAULT_TARGET = 'Кликните, чтобы переместиться сюда';
const MOVE_HINT = 'Кликните по пассажиру, объекту или полу.';
const LANDSCAPE_QUERY = '(max-height: 500px) and (orientation: landscape)';

type FeedTab = 'observations' | 'events' | 'actions';

/** PSD HUD. Public projection and presentation events only; no domain decisions. */
export class GameHud {
  private readonly root = document.createElement('div');
  private readonly tasks = document.createElement('section');
  private readonly tasksToggle = document.createElement('button');
  private readonly phase = document.createElement('p');
  private readonly objective = document.createElement('li');
  private readonly metrics = document.createElement('p');
  private readonly clock = document.createElement('time');
  private readonly dialog = document.createElement('section');
  private readonly speaker = document.createElement('p');
  private readonly dialogText = document.createElement('p');
  private readonly hint = document.createElement('p');
  private readonly observations = document.createElement('div');
  private readonly events = document.createElement('div');
  private readonly actions = document.createElement('div');
  private readonly itemCaption = document.createElement('p');
  private readonly itemSlot = document.createElement('div');
  private readonly toastRoot = document.createElement('div');
  private readonly session = document.createElement('div');
  private readonly sessionText = document.createElement('p');
  private readonly sessionNote = document.createElement('p');
  private readonly sessionSpinner = document.createElement('div');
  private readonly sessionActions = document.createElement('div');
  private readonly sessionGo = document.createElement('a');
  private readonly sessionCancel = document.createElement('button');
  private readonly scales: HTMLButtonElement[] = [];
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly columns: HTMLElement[] = [];
  private readonly landscape = window.matchMedia(LANDSCAPE_QUERY);
  private readonly unsubscribe: () => void;
  private readonly connection: ConnectionStatus;
  private readonly offer: ActionOfferOverlay;
  private readonly feedKeys = new Map<string, string>();
  private heldVisualId: string | null = null;
  private tasksOpen = true;
  private redirectTimer: number | undefined;
  private armedUrl: string | null = null;
  private redirectCancelled = false;
  private guide: OnboardingGuide | null = null;
  private timeBar: HTMLElement | null = null;
  private feedPanel: HTMLElement | null = null;
  private itemsPanel: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly store: PresentationStore,
    interactions: InteractionController,
    downloadLog?: () => void,
  ) {
    this.root.className = 'hud';
    this.buildTasks(downloadLog);
    this.connection = new ConnectionStatus(this.buildTimeBar(interactions), store);
    this.offer = new ActionOfferOverlay(this.buildDialog(), store, interactions);
    this.buildDock();
    this.buildToasts();
    this.buildSession();
    this.buildRotate();
    parent.append(this.root);
    this.mountGuide();
    this.onLayout();
    this.landscape.addEventListener('change', this.onLayout);
    this.unsubscribe = store.subscribe((state) => this.render(state));
  }

  setVisualTime(timeUs: number): void {
    const text = formatSimClock(timeUs);
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  setTarget(text: string | null): void {
    this.hint.textContent = text ?? DEFAULT_TARGET;
  }

  destroy(): void {
    this.unsubscribe();
    this.landscape.removeEventListener('change', this.onLayout);
    window.clearTimeout(this.redirectTimer);
    this.offer.destroy();
    this.connection.destroy();
    this.guide?.destroy();
    this.root.remove();
  }

  private readonly onLayout = (): void => {
    this.setTasksOpen(!this.landscape.matches);
  };

  private buildTasks(downloadLog?: () => void): void {
    this.tasks.className = 'hud-tasks';
    this.tasksToggle.type = 'button';
    this.tasksToggle.className = 'hud-tasks__toggle';
    this.tasksToggle.textContent = 'Задачи';
    this.tasksToggle.setAttribute('aria-controls', 'hud-tasks-body');
    this.tasksToggle.addEventListener('click', () => this.setTasksOpen(!this.tasksOpen));
    const body = el('div', 'hud-tasks__body');
    body.id = 'hud-tasks-body';
    this.phase.className = 'hud-tasks__phase';
    const list = el('ul', 'hud-tasks__list');
    this.objective.className = 'hud-tasks__objective';
    list.append(this.objective);
    this.metrics.className = 'hud-tasks__metrics';
    body.append(this.phase, list, this.metrics);
    if (downloadLog !== undefined) {
      const logButton = el('button', 'hud-tasks__log', 'Скачать лог');
      logButton.type = 'button';
      logButton.addEventListener('click', downloadLog);
      body.append(logButton);
    }
    this.tasks.append(this.tasksToggle, body);
    this.root.append(this.tasks);
  }

  private buildTimeBar(interactions: InteractionController): HTMLElement {
    const bar = el('div', 'hud-time');
    bar.append(this.clock);
    this.clock.className = 'hud-time__clock';
    this.clock.dateTime = 'PT0S';
    this.clock.textContent = '00:00';
    this.clock.setAttribute('aria-label', 'Игровое время');
    const label = el('span', 'hud-time__label', 'Скорость времени');
    bar.append(label);
    for (const scale of [1, 2, 4] as const) {
      const button = el('button', 'hud-speed__button', `×${scale}`);
      button.type = 'button';
      button.dataset.scale = String(scale);
      button.setAttribute('aria-label', `Скорость времени ${scale}x`);
      button.addEventListener('click', () => interactions.setTimeScale(scale));
      bar.append(button);
      this.scales.push(button);
    }
    const help = el('button', 'hud-help', '?');
    help.type = 'button';
    help.setAttribute('aria-label', 'Открыть подсказку');
    help.addEventListener('click', () => this.guide?.open());
    bar.append(help);
    this.timeBar = bar;
    this.root.append(bar);
    return bar;
  }

  private buildDialog(): HTMLElement {
    this.dialog.className = 'hud-dialog';
    this.dialog.hidden = true;
    this.dialog.setAttribute('aria-label', 'Диалог');
    this.speaker.className = 'hud-dialog__speaker';
    this.speaker.hidden = true;
    this.dialogText.className = 'hud-dialog__text';
    this.dialogText.setAttribute('aria-live', 'polite');
    const offerHost = el('div', 'hud-dialog__offer');
    this.dialog.append(this.speaker, this.dialogText, offerHost);
    this.root.append(this.dialog);
    return offerHost;
  }

  private buildDock(): void {
    const dock = el('div', 'hud-dock');
    this.hint.className = 'hud-hint';
    this.hint.textContent = DEFAULT_TARGET;
    const strip = el('section', 'hud-strip');
    strip.setAttribute('aria-label', 'Журнал смены');
    const tabs = el('div', 'hud-strip__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Колонки журнала');
    const columns = el('div', 'hud-strip__columns');
    this.addColumn(tabs, columns, 'observations', 'Наблюдения', this.observations);
    this.addColumn(tabs, columns, 'events', 'События', this.events);
    this.addColumn(tabs, columns, 'actions', 'Действия', this.actions);
    strip.append(tabs, columns);
    this.feedPanel = strip;

    const items = el('aside', 'hud-items');
    items.setAttribute('aria-label', 'Предметы');
    this.itemCaption.className = 'hud-items__caption';
    this.itemCaption.textContent = 'В руках: пусто';
    const title = el('h2', 'hud-items__title', 'Предметы');
    this.itemSlot.className = 'hud-items__slot';
    this.itemSlot.dataset.item = 'empty';
    items.append(this.itemCaption, title, this.itemSlot);
    this.itemsPanel = items;
    dock.append(this.hint, strip, items);
    this.root.append(dock);
    this.selectTab('observations');
  }

  private addColumn(
    tabs: HTMLElement,
    columns: HTMLElement,
    tab: FeedTab,
    title: string,
    body: HTMLElement,
  ): void {
    const button = el('button', 'hud-strip__tab', title);
    button.type = 'button';
    button.dataset.tab = tab;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `hud-panel-${tab}`);
    button.addEventListener('click', () => this.selectTab(tab));
    tabs.append(button);
    this.tabButtons.push(button);

    const column = el('section', 'hud-col');
    column.id = `hud-panel-${tab}`;
    column.dataset.panel = tab;
    column.setAttribute('role', 'tabpanel');
    const heading = el('h2', 'hud-col__title', title);
    body.className = 'hud-col__body';
    column.append(heading, body);
    columns.append(column);
    this.columns.push(column);
  }

  private buildToasts(): void {
    this.toastRoot.className = 'hud-toasts';
    this.toastRoot.setAttribute('aria-live', 'polite');
    this.toastRoot.addEventListener('pointerover', (event) => {
      if (event.pointerType === 'touch') return;
      const id = toastIdFrom(event.target);
      if (id !== null) this.store.pauseToast(id);
    });
    this.toastRoot.addEventListener('pointerout', (event) => {
      if (event.pointerType === 'touch') return;
      const id = toastIdFrom(event.target);
      if (id === null) return;
      const item = event.target instanceof Element ? event.target.closest('[data-toast-id]') : null;
      if (
        item !== null &&
        event.relatedTarget instanceof Node &&
        item.contains(event.relatedTarget)
      ) {
        return;
      }
      this.store.resumeToast(id);
    });
    this.root.append(this.toastRoot);
  }

  private buildSession(): void {
    this.session.className = 'hud-session';
    this.session.hidden = true;
    this.session.setAttribute('role', 'status');
    this.session.setAttribute('aria-live', 'assertive');
    const card = el('div', 'hud-session__card');
    this.sessionText.className = 'hud-session__text';
    this.sessionNote.className = 'hud-session__note';
    this.sessionNote.hidden = true;
    this.sessionSpinner.className = 'hud-session__spinner';
    this.sessionSpinner.hidden = true;
    this.sessionSpinner.setAttribute('aria-hidden', 'true');
    this.sessionActions.className = 'hud-session__actions';
    this.sessionActions.hidden = true;
    this.sessionGo.className = 'hud-session__go';
    this.sessionGo.textContent = 'Посмотреть результат';
    this.sessionCancel.type = 'button';
    this.sessionCancel.className = 'hud-session__cancel';
    this.sessionCancel.textContent = 'Остаться';
    this.sessionCancel.addEventListener('click', () => this.cancelRedirect());
    this.sessionActions.append(this.sessionGo, this.sessionCancel);
    card.append(this.sessionText, this.sessionNote, this.sessionSpinner, this.sessionActions);
    this.session.append(card);
    this.root.append(this.session);
  }

  private buildRotate(): void {
    const rotate = el('div', 'hud-rotate');
    rotate.append(el('p', 'hud-rotate__text', 'Поверните телефон горизонтально'));
    this.root.append(rotate);
  }

  private mountGuide(): void {
    const time = this.timeBar;
    const feed = this.feedPanel;
    const items = this.itemsPanel;
    if (time === null || feed === null || items === null) return;
    const targets = new Map<GuideTargetId, HTMLElement>([
      ['tasks', this.tasks],
      ['hint', this.hint],
      ['feed', feed],
      ['items', items],
      ['time', time],
    ]);
    this.guide = new OnboardingGuide({
      parent: this.root,
      storage: availableLocalStorage(),
      targets,
    });
  }

  private setTasksOpen(open: boolean): void {
    this.tasksOpen = open;
    this.tasks.dataset.open = open ? 'true' : 'false';
    this.tasksToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private selectTab(tab: FeedTab): void {
    for (const button of this.tabButtons) {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    for (const column of this.columns) {
      column.dataset.active = column.dataset.panel === tab ? 'true' : 'false';
    }
  }

  private render(state: Readonly<PresentationState>): void {
    this.renderTasks(state);
    this.renderSpeed(state);
    this.renderDialog(state);
    this.paintFeed(
      'observations',
      this.observations,
      state.observations.map((entry) => ({
        atUs: entry.atUs,
        text: `${entry.speaker}: ${entry.text}`,
      })),
      'Наблюдений пока нет.',
    );
    this.paintFeed('events', this.events, state.events, 'Событий пока нет.');
    this.renderActions(state);
    this.renderItem(state);
    this.renderToasts(state.toasts);
    this.renderSession(state);
  }

  private renderTasks(state: Readonly<PresentationState>): void {
    const phase = state.publicState?.phase ?? null;
    this.phase.textContent = phase === null ? 'Ожидание' : phaseLabel(phase);
    this.objective.textContent = phaseObjective(phase);
    this.metrics.textContent = metricsLine(state.publicState);
  }

  private renderSpeed(state: Readonly<PresentationState>): void {
    const publicState = state.publicState;
    const enabled =
      state.connection === 'connected' &&
      publicState !== null &&
      publicState.mode.kind !== 'replay' &&
      publicState.phase.kind !== 'finished';
    for (const button of this.scales) {
      const scale = Number(button.dataset.scale);
      const active = publicState?.clock.timeScale === scale;
      button.disabled = !enabled;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  private renderDialog(state: Readonly<PresentationState>): void {
    const line = state.dialog;
    const offer = state.currentOffer;
    const hasOffer = offer !== null && offer.actions.length > 0;
    this.dialog.hidden = line === null && !hasOffer;
    if (line === null) {
      this.speaker.hidden = true;
      this.speaker.textContent = '';
      this.dialogText.textContent = '';
      return;
    }
    const named = line.speaker !== null;
    this.speaker.hidden = !named;
    this.speaker.textContent = line.speaker ?? '';
    this.dialogText.textContent = line.text;
  }

  private renderActions(state: Readonly<PresentationState>): void {
    const labels = state.currentOffer?.actions.map((action) => action.label) ?? [];
    const signature = labels.join('\n');
    if (this.feedKeys.get('actions') === signature) return;
    this.feedKeys.set('actions', signature);
    this.actions.replaceChildren();
    if (labels.length === 0) {
      this.actions.append(el('p', 'hud-feed__empty', MOVE_HINT));
      return;
    }
    const list = el('ul', 'hud-feed');
    for (const label of labels) list.append(el('li', 'hud-feed__item', label));
    this.actions.append(list);
  }

  private renderItem(state: Readonly<PresentationState>): void {
    const held = state.publicState?.entities.find((entity) => entity.kind === 'player')?.heldItem;
    const visualId = held?.visualId ?? '';
    this.itemCaption.textContent =
      held === undefined ? 'В руках: пусто' : `В руках: ${heldItemName(held.visualId)}`;
    if (visualId === this.heldVisualId) return;
    this.heldVisualId = visualId;
    this.itemSlot.replaceChildren();
    this.itemSlot.dataset.item = visualId === '' ? 'empty' : visualId;
    if (held === undefined) return;
    if (held.visualId === 'item.extinguisher') {
      const image = document.createElement('img');
      image.className = 'hud-items__icon';
      image.src = extinguisherUrl;
      image.alt = 'Огнетушитель';
      image.width = 96;
      image.height = 138;
      this.itemSlot.append(image);
      return;
    }
    if (held.visualId === 'item.acceptance-journal') {
      this.itemSlot.append(journalGlyph());
      return;
    }
    this.itemSlot.append(el('span', 'hud-items__fallback', heldItemName(held.visualId)));
  }

  private renderToasts(toasts: readonly PresentationToast[]): void {
    const signature = toasts.map((toast) => `${toast.id}:${toast.text}`).join('\n');
    if (this.feedKeys.get('toasts') === signature) return;
    this.feedKeys.set('toasts', signature);
    this.toastRoot.replaceChildren();
    for (const toast of toasts) {
      const item = el(
        'p',
        toast.variant === 'achievement' ? 'hud-toast hud-toast--achievement' : 'hud-toast',
      );
      if (toast.variant === 'achievement') {
        item.append(el('span', 'hud-toast__kicker', 'Достижение'));
      }
      item.dataset.toastId = toast.id;
      item.append(el('span', 'hud-toast__text', toast.text));
      this.toastRoot.append(item);
    }
  }

  private renderSession(state: Readonly<PresentationState>): void {
    const current = state.sessionState;
    if (current === null || current.state === 'active') {
      this.hideSession();
      return;
    }
    if (current.state === 'paused') {
      this.showBanner('Связь потеряна, игра на паузе…', 'paused');
      return;
    }
    if (current.state === 'finishing') {
      this.showBanner('Подводим итоги рейса…', 'finishing');
      return;
    }
    if (current.state === 'aborted') {
      this.showBanner('Попытка прервана', 'aborted');
      return;
    }
    this.showFinished(current.redirectUrl);
  }

  private paintFeed(
    key: string,
    container: HTMLElement,
    entries: readonly { atUs: number; text: string }[],
    empty: string,
  ): void {
    const signature = entries.map((entry) => `${entry.atUs}:${entry.text}`).join('\n');
    if (this.feedKeys.get(key) === signature) return;
    this.feedKeys.set(key, signature);
    container.replaceChildren();
    if (entries.length === 0) {
      container.append(el('p', 'hud-feed__empty', empty));
      return;
    }
    const list = el('ul', 'hud-feed');
    for (const entry of entries) {
      const item = el('li', 'hud-feed__item');
      const time = el('time', 'hud-feed__time', formatSimClock(entry.atUs));
      time.dateTime = `PT${Math.floor(entry.atUs / 1_000_000)}S`;
      item.append(time, document.createTextNode(` ${entry.text}`));
      list.append(item);
    }
    container.append(list);
  }

  private showBanner(text: string, kind: 'paused' | 'finishing' | 'aborted'): void {
    this.clearRedirect();
    this.session.hidden = false;
    this.session.dataset.kind = kind;
    this.sessionText.textContent = text;
    this.sessionNote.hidden = true;
    this.sessionSpinner.hidden = kind !== 'finishing';
    this.sessionActions.hidden = true;
  }

  private showFinished(url: string | undefined): void {
    this.session.hidden = false;
    this.session.dataset.kind = 'finished';
    this.sessionText.textContent = 'Рейс завершён';
    this.sessionSpinner.hidden = true;
    if (url === undefined) {
      this.sessionNote.hidden = true;
      this.sessionActions.hidden = true;
      this.clearRedirect();
      return;
    }
    this.sessionNote.hidden = false;
    this.sessionNote.textContent = 'Результат откроется через несколько секунд.';
    this.sessionActions.hidden = false;
    this.sessionGo.href = url;
    this.armRedirect(url);
  }

  private hideSession(): void {
    this.session.hidden = true;
    this.clearRedirect();
  }

  private armRedirect(url: string): void {
    if (this.armedUrl === url) return;
    window.clearTimeout(this.redirectTimer);
    this.armedUrl = url;
    this.redirectCancelled = false;
    this.sessionCancel.hidden = false;
    this.redirectTimer = window.setTimeout(() => {
      if (this.redirectCancelled || this.armedUrl !== url) return;
      window.location.assign(url);
    }, REDIRECT_DELAY_MS);
  }

  private cancelRedirect(): void {
    this.redirectCancelled = true;
    window.clearTimeout(this.redirectTimer);
    this.redirectTimer = undefined;
    this.sessionCancel.hidden = true;
    this.sessionNote.textContent = 'Автопереход отменён.';
  }

  private clearRedirect(): void {
    window.clearTimeout(this.redirectTimer);
    this.redirectTimer = undefined;
    this.armedUrl = null;
    this.redirectCancelled = false;
  }
}

function toastIdFrom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-toast-id]')?.dataset.toastId ?? null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function journalGlyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 80');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('hud-items__glyph');
  const cover = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  cover.setAttribute('x', '10');
  cover.setAttribute('y', '8');
  cover.setAttribute('width', '44');
  cover.setAttribute('height', '64');
  cover.setAttribute('rx', '3');
  cover.setAttribute('fill', 'none');
  cover.setAttribute('stroke', '#eef9ff');
  cover.setAttribute('stroke-width', '4');
  const spine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  spine.setAttribute('d', 'M22 8 V72');
  spine.setAttribute('fill', 'none');
  spine.setAttribute('stroke', '#95dbd0');
  spine.setAttribute('stroke-width', '4');
  svg.append(cover, spine);
  return svg;
}
