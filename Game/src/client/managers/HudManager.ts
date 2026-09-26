import type { CommandInput, ConnectionStatus } from '../connection';
import { addLine, button, node } from '../dom';
import type { ObservableSnapshot, PoiView } from '../protocol';
import type { Selection } from '../selection';
import type { ClientState } from '../state';

const SCENARIOS = [
  { id: 'pressure', label: 'Давление' },
  { id: 'fire', label: 'Пожар' },
  { id: 'service', label: 'Сервис' },
  { id: 'conflict', label: 'Конфликт' },
] as const;

/** Owns the DOM shell, observable HUD, task cards and debrief. */
export class HudManager {
  readonly detailsRoot = node('div', 'details');
  readonly dialogueRoot = node('div', 'dialogue');
  readonly footer = node('div', 'footer-actions');
  readonly devControls = node('div', 'dev-controls');
  private readonly debriefRoot = node('div', 'debrief');
  private readonly status = node('div', 'connection-state');
  private readonly clock = node('div', 'clock');
  private readonly metrics = node('div', 'metrics');
  private readonly message = node('div', 'message');
  private readonly cues = node('div', 'cues');
  private readonly tasks = node('div', 'task-list');
  private readonly item = node('div', 'item-state');
  private readonly dashboard = node('details', 'dashboard');
  private readonly dashboardSummary = node('summary', 'dashboard-summary', 'Задачи и действия');
  private readonly retry: HTMLButtonElement;
  private readonly finish: HTMLButtonElement;
  private readonly clockInterval: ReturnType<typeof setInterval>;
  private readonly onResize = (): void => {
    const narrow = window.innerWidth <= 760;
    if (narrow !== this.wasNarrow) this.dashboard.open = !narrow;
    this.wasNarrow = narrow;
  };
  private readonly onDashboardClick = (event: MouseEvent): void => {
    if (window.innerWidth <= 760 && event.target instanceof HTMLButtonElement)
      this.dashboard.open = false;
  };
  private wasNarrow = window.innerWidth <= 760;
  private last: ObservableSnapshot | null = null;
  private lastTasks: ObservableSnapshot['tasks'] | null = null;
  private lastItem: ObservableSnapshot['item'] | null = null;
  private lastPoi: PoiView[] | null = null;
  private lastCueIds = '';
  private lastDebrief: ObservableSnapshot['debrief'] = null;
  private receivedAt = Date.now();
  private localMessage = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly send: (input: CommandInput) => void,
    private readonly reconnect: () => void,
    private readonly select: (selection: Selection) => void,
    private readonly goToAnchor: (id: string) => void,
    private readonly isNear: (id: string) => boolean,
  ) {
    const panel = node('aside', 'game-panel');
    const header = node('div', 'panel-header');
    header.append(node('h1', '', 'ВСМ · Смена 04'), this.status);
    panel.append(header, this.clock, this.metrics, this.message);
    this.dashboard.open = !this.wasNarrow;
    window.addEventListener('resize', this.onResize);
    this.dashboard.append(this.dashboardSummary);
    const taskSection = node('section', 'panel-section');
    taskSection.append(node('h2', '', 'Задачи'), this.tasks);
    this.dashboard.append(taskSection);
    const signalSection = node('section', 'panel-section');
    signalSection.append(node('h2', '', 'Наблюдения'), this.cues);
    this.dashboard.append(signalSection);
    const itemSection = node('section', 'panel-section');
    itemSection.append(node('h2', '', 'Предмет'), this.item);
    this.dashboard.append(itemSection, this.footer);
    this.dashboard.addEventListener('click', this.onDashboardClick);
    panel.append(this.dashboard);

    const detailPanel = node('div', 'detail-panel');
    detailPanel.append(this.detailsRoot, this.dialogueRoot, this.debriefRoot);
    this.root.append(panel, detailPanel);

    this.retry = button('Повторить подключение', () => this.reconnect());
    this.retry.hidden = true;
    this.footer.append(this.retry);
    this.finish = button('Показать итог смены', () => this.send({ kind: 'finish' }));
    this.finish.dataset.finish = 'true';
    this.footer.append(this.finish);
    if (import.meta.env.DEV) {
      this.devControls.append(node('h2', '', 'Тестовые ветки'));
      for (const scenario of SCENARIOS)
        this.devControls.append(
          button(scenario.label, () => this.send({ kind: 'dev-control', optionId: scenario.id })),
        );
      const disconnect = button('Проверить связь', () =>
        this.send({ kind: 'dev-control', optionId: 'disconnect' }),
      );
      disconnect.dataset.disconnect = 'true';
      this.devControls.append(disconnect);
      this.footer.append(this.devControls);
    }
    this.clockInterval = setInterval(() => this.refreshClock(), 500);
  }

  addSoundControl(control: HTMLElement): void {
    this.footer.insertBefore(
      control,
      this.devControls.parentElement === this.footer ? this.devControls : null,
    );
  }

  say(message: string): void {
    this.localMessage = message;
    this.message.textContent = message;
    if (message.includes('подошёл') && this.last !== null) this.renderTasks(this.last);
  }

  reset(): void {
    this.last = null;
    this.lastTasks = null;
    this.lastItem = null;
    this.lastPoi = null;
    this.lastCueIds = '';
    this.lastDebrief = null;
    this.localMessage = '';
    this.cues.replaceChildren();
    this.tasks.replaceChildren();
    this.item.replaceChildren();
    this.debriefRoot.replaceChildren();
    this.debriefRoot.hidden = true;
    this.detailsRoot.hidden = false;
    this.dialogueRoot.hidden = false;
  }

  render(state: ClientState, status: ConnectionStatus): void {
    const snapshot = state.snapshot;
    const statusLabels: Record<ConnectionStatus, string> = {
      connecting: 'Подключение',
      ready: 'Связь есть',
      'temporarily disconnected': 'Связь потеряна',
      reconnecting: 'Переподключение',
      failed: 'Нет связи',
    };
    this.status.textContent = `● ${statusLabels[status]}`;
    this.status.dataset.state = status;
    this.retry.hidden = status !== 'failed';
    if (snapshot === null) {
      this.message.textContent =
        status === 'failed'
          ? 'Соединение не установлено. Проверьте адрес сервера.'
          : 'Подключение к игровому серверу…';
      this.finish.disabled = true;
      return;
    }
    if (this.last?.simulationTime !== snapshot.simulationTime) this.receivedAt = Date.now();
    this.last = snapshot;
    const activeTasks = snapshot.tasks.filter((task) => task.state === 'open').length;
    this.dashboardSummary.textContent = `Задачи ${activeTasks} · Сигналы ${snapshot.cues.length} · Действия`;
    this.refreshClock();
    this.metrics.textContent =
      snapshot.metrics === null
        ? 'Оценки появятся после наблюдения сервера.'
        : `Безопасность ${snapshot.metrics.safety} · Сервис ${snapshot.metrics.satisfaction}`;
    this.message.textContent = state.notice || this.localMessage || snapshot.message;
    this.message.dataset.pending = Object.keys(state.pending).length > 0 ? 'true' : 'false';
    if (snapshot.tasks !== this.lastTasks) {
      this.renderTasks(snapshot);
      this.lastTasks = snapshot.tasks;
    }
    if (snapshot.item !== this.lastItem || snapshot.poi !== this.lastPoi) {
      this.renderItem(snapshot);
      this.lastItem = snapshot.item;
      this.lastPoi = snapshot.poi;
    }
    const cueIds = snapshot.cues.map((cue) => cue.id).join('|');
    if (cueIds !== this.lastCueIds) {
      this.renderCues(snapshot);
      this.lastCueIds = cueIds;
    }
    if (snapshot.debrief !== this.lastDebrief) {
      this.renderDebrief(snapshot);
      this.lastDebrief = snapshot.debrief;
    }
    this.finish.disabled = status !== 'ready' || snapshot.phase === 'finished';
  }

  destroy(): void {
    clearInterval(this.clockInterval);
    window.removeEventListener('resize', this.onResize);
    this.dashboard.removeEventListener('click', this.onDashboardClick);
    this.root.replaceChildren();
  }

  private refreshClock(): void {
    const snapshot = this.last;
    if (snapshot === null) return;
    const speed = snapshot.controls?.speed ?? 1;
    const interpolated =
      snapshot.simulationTime +
      (snapshot.phase === 'finished'
        ? 0
        : Math.min((Date.now() - this.receivedAt) / 1000, 1) * speed);
    this.clock.textContent = `${snapshot.phase === 'boarding' ? 'Посадка' : snapshot.phase === 'ride' ? 'Поездка' : 'Итог'} · ${interpolated.toFixed(1)} с${snapshot.controls ? ` · ×${speed}` : ''}`;
    for (const element of Array.from(this.tasks.querySelectorAll<HTMLElement>('[data-deadline]'))) {
      const deadline = Number(element.dataset.deadline);
      element.textContent = `Осталось ${Math.max(0, deadline - interpolated).toFixed(0)} с`;
    }
  }

  private renderTasks(snapshot: ObservableSnapshot): void {
    this.tasks.replaceChildren();
    if (snapshot.tasks.length === 0) {
      addLine(this.tasks, 'Активных запросов нет.', 'muted');
      return;
    }
    for (const task of snapshot.tasks) {
      const card = node('article', `task task-${task.state}`);
      card.append(node('strong', '', task.title));
      addLine(
        card,
        `Источник: ${task.sourceId} · ${task.urgency === 'urgent' ? 'срочно' : 'обычно'}`,
      );
      addLine(card, `Состояние: ${task.state}`);
      if (task.state === 'open') {
        const time = node('small', 'deadline');
        time.dataset.deadline = String(task.hardDeadline);
        card.append(time);
        const source = snapshot.npcs.find((npc) => npc.id === task.sourceId);
        if (source !== undefined) {
          card.append(
            button('Поговорить с пассажиром', () => {
              this.select({ kind: 'npc', id: source.id });
              this.goToAnchor(source.intent.targetId);
            }),
          );
        }
        card.append(button('Подойти к цели', () => this.goToAnchor(task.targetId)));
        for (const action of task.actions) {
          card.append(
            button(
              action.label,
              () => this.send({ kind: action.kind, targetId: task.id }),
              !action.enabled || !this.isNear(task.targetId),
            ),
          );
        }
      }
      this.tasks.append(card);
    }
    this.refreshClock();
  }

  private renderItem(snapshot: ObservableSnapshot): void {
    this.item.replaceChildren();
    const labels = {
      stored: 'На месте хранения',
      held: 'В руках · не подготовлен',
      prepared: 'В руках · подготовлен',
      used: 'Использован',
    };
    addLine(this.item, `Огнетушитель: ${labels[snapshot.item]}`);
    if (snapshot.item === 'stored') {
      this.item.append(
        button('Подойти к огнетушителю', () => {
          this.select({ kind: 'poi', id: 'extinguisher' });
          this.goToAnchor('extinguisher');
        }),
      );
    }
    if (snapshot.item === 'held')
      this.item.append(
        button('Подготовить огнетушитель', () =>
          this.send({ kind: 'interact', targetId: 'extinguisher' }),
        ),
      );
    if (snapshot.item === 'prepared' && snapshot.poi.some((poi) => poi.id === 'fire-zone')) {
      this.item.append(
        button('Подойти к очагу', () => {
          this.select({ kind: 'poi', id: 'fire-zone' });
          this.goToAnchor('fire-zone');
        }),
      );
    }
  }

  private renderCues(snapshot: ObservableSnapshot): void {
    this.cues.replaceChildren(
      ...snapshot.cues.map((cue) => {
        const card = node('div', `cue cue-${cue.kind}`);
        addLine(card, cue.text);
        const source = snapshot.npcs.find((npc) => npc.id === cue.sourceId);
        if (source !== undefined) {
          card.append(
            button('Поговорить с пассажиром', () => {
              this.select({ kind: 'npc', id: source.id });
              this.goToAnchor(source.intent.targetId);
            }),
          );
        }
        if (cue.anchorId !== undefined && snapshot.poi.some((poi) => poi.id === cue.anchorId)) {
          card.append(
            button('Подойти к признаку', () => {
              if (cue.anchorId === undefined) return;
              this.select({ kind: 'poi', id: cue.anchorId });
              this.goToAnchor(cue.anchorId);
            }),
          );
        }
        return card;
      }),
    );
    if (snapshot.cues.length === 0) addLine(this.cues, 'Пока нет новых признаков.', 'muted');
  }

  private renderDebrief(snapshot: ObservableSnapshot): void {
    const debrief = snapshot.debrief;
    this.debriefRoot.replaceChildren();
    const finished = debrief !== null;
    this.debriefRoot.hidden = !finished;
    this.detailsRoot.hidden = finished;
    this.dialogueRoot.hidden = finished;
    if (debrief === null) return;
    this.debriefRoot.append(node('h2', '', debrief.title));
    addLine(
      this.debriefRoot,
      `Безопасность ${debrief.safety} · Сервис ${debrief.satisfaction}`,
      'observation',
    );
    for (const line of debrief.process) addLine(this.debriefRoot, line);
    for (const line of debrief.outcome) addLine(this.debriefRoot, line);
  }
}
