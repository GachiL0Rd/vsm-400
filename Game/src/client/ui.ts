import type { CommandInput, ConnectionStatus, GameConnection } from './connection';
import type { ActionView, NpcView, ObservableSnapshot, PoiView } from './protocol';
import type { ClientScene, Selection } from './scene';
import type { ClientState } from './state';

const SCENARIOS = [
  { id: 'pressure', label: 'Давление' },
  { id: 'fire', label: 'Пожар' },
  { id: 'service', label: 'Сервис' },
  { id: 'conflict', label: 'Конфликт' },
] as const;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = node('button', 'game-button', label);
  element.type = 'button';
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}

function addLine(parent: HTMLElement, value: string, className = ''): void {
  parent.append(node('p', className, value));
}

export class ClientUI {
  private readonly status = node('div', 'connection-state');
  private readonly clock = node('div', 'clock');
  private readonly metrics = node('div', 'metrics');
  private readonly message = node('div', 'message');
  private readonly cues = node('div', 'cues');
  private readonly tasks = node('div', 'task-list');
  private readonly item = node('div', 'item-state');
  private readonly details = node('div', 'details');
  private readonly dialogue = node('div', 'dialogue');
  private readonly footer = node('div', 'footer-actions');
  private readonly dashboard = node('details', 'dashboard');
  private readonly dashboardSummary = node('summary', 'dashboard-summary', 'Задачи и действия');
  private readonly retry = button('Повторить подключение', () => this.connection.connect());
  private selection: Selection | null = null;
  private dismissedDialogue: string | null = null;
  private last: ObservableSnapshot | null = null;
  private lastSnapshotSerial = 0;
  private lastPoi: PoiView[] | null = null;
  private lastNpcs: NpcView[] | null = null;
  private lastTasks: ObservableSnapshot['tasks'] | null = null;
  private lastDialogue: ObservableSnapshot['dialogue'] = null;
  private lastItem: ObservableSnapshot['item'] | null = null;
  private lastDebrief: ObservableSnapshot['debrief'] = null;
  private lastCueIds = '';
  private receivedAt = Date.now();
  private volume = 0.2;
  private audio: AudioContext | null = null;
  private localMessage = '';

  constructor(
    root: HTMLElement,
    private readonly connection: GameConnection,
    private readonly scene: ClientScene,
  ) {
    const panel = node('aside', 'game-panel');
    const header = node('div', 'panel-header');
    header.append(node('h1', '', 'ВСМ · Смена 04'), this.status);
    panel.append(header, this.clock, this.metrics, this.message);
    this.dashboard.open = window.innerWidth >= 760;
    let wasNarrow = window.innerWidth < 760;
    window.addEventListener('resize', () => {
      const narrow = window.innerWidth < 760;
      if (narrow !== wasNarrow) this.dashboard.open = !narrow;
      wasNarrow = narrow;
    });
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
    this.dashboard.addEventListener('click', (event) => {
      if (window.innerWidth < 760 && event.target instanceof HTMLButtonElement)
        this.dashboard.open = false;
    });
    panel.append(this.dashboard);

    const detailPanel = node('div', 'detail-panel');
    detailPanel.append(this.details, this.dialogue);
    root.append(panel, detailPanel);
    this.buildFooter();
    setInterval(() => this.refreshClock(), 500);
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.scene.highlight(selection);
    this.dismissedDialogue = null;
    this.renderDetails(this.connection.getState().snapshot);
  }

  say(message: string): void {
    this.localMessage = message;
    this.message.textContent = message;
    if (message.includes('подошёл')) {
      const snapshot = this.connection.getState().snapshot;
      this.renderDetails(snapshot);
      if (snapshot !== null) this.renderTasks(snapshot);
    }
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
      return;
    }
    if (
      state.snapshotSerial !== this.lastSnapshotSerial ||
      this.last?.sessionId !== snapshot.sessionId ||
      snapshot.revision < (this.last?.revision ?? 0)
    ) {
      this.selection = null;
      this.scene.highlight(null);
      this.dismissedDialogue = null;
      this.lastPoi = null;
      this.lastNpcs = null;
      this.lastTasks = null;
      this.lastDialogue = null;
      this.lastItem = null;
      this.lastDebrief = null;
      this.lastCueIds = '';
      this.dialogue.replaceChildren();
      this.cues.replaceChildren();
    }
    this.lastSnapshotSerial = state.snapshotSerial;
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
    const poiChanged = snapshot.poi !== this.lastPoi;
    if (poiChanged || snapshot.npcs !== this.lastNpcs || snapshot.item !== this.lastItem) {
      this.renderDetails(snapshot);
      this.lastPoi = snapshot.poi;
      this.lastNpcs = snapshot.npcs;
    }
    if (snapshot.tasks !== this.lastTasks) {
      this.renderTasks(snapshot);
      this.lastTasks = snapshot.tasks;
    }
    if (snapshot.item !== this.lastItem || poiChanged) {
      this.renderItem(snapshot);
      this.lastItem = snapshot.item;
    }
    if (snapshot.dialogue !== this.lastDialogue) {
      this.dismissedDialogue = null;
      this.renderDialogue(snapshot);
      this.lastDialogue = snapshot.dialogue;
    }
    if (snapshot.debrief !== this.lastDebrief) {
      this.renderDebrief(snapshot);
      this.lastDebrief = snapshot.debrief;
    }
    const cueIds = snapshot.cues.map((cue) => cue.id).join('|');
    if (cueIds !== this.lastCueIds) {
      const previous = this.lastCueIds.split('|');
      if (
        snapshot.cues.some(
          (cue) =>
            !previous.includes(cue.id) &&
            (cue.kind === 'call' || cue.kind === 'fire' || cue.kind === 'whistle'),
        )
      )
        this.beep();
      this.cues.replaceChildren(
        ...snapshot.cues.map((cue) => {
          const card = node('div', `cue cue-${cue.kind}`);
          addLine(card, cue.text);
          const source = snapshot.npcs.find((npc) => npc.id === cue.sourceId);
          if (source !== undefined) {
            card.append(
              button('Поговорить с пассажиром', () => {
                this.select({ kind: 'npc', id: source.id });
                this.scene.goToAnchor(source.intent.targetId);
              }),
            );
          }
          if (cue.anchorId !== undefined && snapshot.poi.some((poi) => poi.id === cue.anchorId)) {
            card.append(
              button('Подойти к признаку', () => {
                if (cue.anchorId === undefined) return;
                this.select({ kind: 'poi', id: cue.anchorId });
                this.scene.goToAnchor(cue.anchorId);
              }),
            );
          }
          return card;
        }),
      );
      if (snapshot.cues.length === 0) addLine(this.cues, 'Пока нет новых признаков.', 'muted');
      this.lastCueIds = cueIds;
    }
    const finish = this.footer.querySelector<HTMLButtonElement>('[data-finish]');
    if (finish !== null) finish.disabled = status !== 'ready' || snapshot.phase === 'finished';
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
              this.scene.goToAnchor(source.intent.targetId);
            }),
          );
        }
        card.append(button('Подойти к цели', () => this.scene.goToAnchor(task.targetId)));
        for (const action of task.actions) {
          card.append(
            button(
              action.label,
              () => this.send({ kind: action.kind, targetId: task.id }),
              !action.enabled || !this.scene.isNear(task.targetId),
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
          this.scene.goToAnchor('extinguisher');
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
          this.scene.goToAnchor('fire-zone');
        }),
      );
    }
  }

  private renderDetails(snapshot: ObservableSnapshot | null): void {
    this.details.replaceChildren();
    if (snapshot === null || this.selection === null) {
      addLine(
        this.details,
        'Кликните по пассажиру или объекту. Клик по полу задаёт маршрут.',
        'muted',
      );
      return;
    }
    const poi =
      this.selection.kind === 'poi'
        ? snapshot.poi.find((entry) => entry.id === this.selection?.id)
        : undefined;
    const npc =
      this.selection.kind === 'npc'
        ? snapshot.npcs.find((entry) => entry.id === this.selection?.id)
        : undefined;
    if (poi === undefined && npc === undefined) {
      this.selection = null;
      this.scene.highlight(null);
      return;
    }
    const target: PoiView | NpcView = poi ?? (npc as NpcView);
    const anchor = npc?.intent.targetId ?? npc?.anchorId ?? target.id;
    this.details.append(node('h2', '', target.label));
    if (poi?.observation !== undefined) addLine(this.details, poi.observation, 'observation');
    if (npc?.speech !== undefined) addLine(this.details, `— ${npc.speech}`, 'observation');
    if (!this.scene.isNear(anchor)) {
      this.details.append(button('Подойти', () => this.scene.goToAnchor(anchor)));
      addLine(this.details, 'Для действия сначала подойдите к объекту.', 'muted');
    } else {
      for (const action of target.actions)
        this.details.append(this.actionButton(action, target.id));
    }
    this.details.append(
      button('Закрыть', () => {
        this.selection = null;
        this.scene.highlight(null);
        this.renderDetails(snapshot);
      }),
    );
  }

  private actionButton(action: ActionView, targetId: string): HTMLButtonElement {
    const input: CommandInput =
      action.kind === 'inspect'
        ? { kind: 'inspect', targetId, inspection: action.id === 'full' ? 'full' : 'quick' }
        : { kind: action.kind, targetId };
    const label = action.enabled
      ? action.label
      : `${action.label} · ${action.disabledReason ?? 'недоступно'}`;
    return button(label, () => this.send(input), !action.enabled);
  }

  private renderDialogue(snapshot: ObservableSnapshot): void {
    this.dialogue.replaceChildren();
    const active = snapshot.dialogue;
    if (active === null || this.dismissedDialogue === active.id) return;
    this.dialogue.append(node('h2', '', active.title));
    for (const line of active.lines) addLine(this.dialogue, line, 'dialogue-line');
    if (active.document !== undefined && active.ticket !== undefined) {
      const cards = node('div', 'document-cards');
      const document = node('div', 'document-card');
      document.append(node('strong', '', 'Удостоверение'));
      addLine(
        document,
        `${active.document.fullName}\n№ ${active.document.number}\nДата рождения: ${active.document.birthDate}`,
      );
      const ticket = node('div', 'document-card');
      ticket.append(node('strong', '', 'Билет'));
      addLine(
        ticket,
        `${active.ticket.fullName}\n${active.ticket.train} · вагон ${active.ticket.carriage} · место ${active.ticket.seat}`,
      );
      cards.append(document, ticket);
      this.dialogue.append(cards);
    }
    for (const option of active.options) {
      this.dialogue.append(
        button(
          option.enabled
            ? option.label
            : `${option.label} · ${option.disabledReason ?? 'недоступно'}`,
          () => this.send({ kind: 'dialogue-choice', targetId: active.npcId, optionId: option.id }),
          !option.enabled,
        ),
      );
    }
    this.dialogue.append(
      button('Закрыть окно', () => {
        this.dismissedDialogue = active.id;
        this.dialogue.replaceChildren();
      }),
    );
  }

  private renderDebrief(snapshot: ObservableSnapshot): void {
    if (snapshot.debrief === null) return;
    this.selection = null;
    this.scene.highlight(null);
    this.details.replaceChildren();
    this.details.append(node('h2', '', snapshot.debrief.title));
    addLine(
      this.details,
      `Безопасность ${snapshot.debrief.safety} · Сервис ${snapshot.debrief.satisfaction}`,
      'observation',
    );
    for (const line of snapshot.debrief.process) addLine(this.details, line);
    for (const line of snapshot.debrief.outcome) addLine(this.details, line);
    this.dialogue.replaceChildren();
  }

  private buildFooter(): void {
    this.retry.hidden = true;
    this.footer.append(this.retry);
    const finish = button('Показать итог смены', () => this.send({ kind: 'finish' }));
    finish.dataset.finish = 'true';
    this.footer.append(finish);
    const sound = node('label', 'sound-control', 'Звук: ');
    const volume = node('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.value = String(this.volume);
    volume.setAttribute('aria-label', 'Громкость сигналов');
    volume.addEventListener('input', () => {
      this.volume = Number(volume.value);
    });
    sound.append(volume);
    this.footer.append(sound);
    if (import.meta.env.DEV) {
      const dev = node('div', 'dev-controls');
      dev.append(node('h2', '', 'Тестовые ветки'));
      for (const scenario of SCENARIOS)
        dev.append(
          button(scenario.label, () => this.send({ kind: 'dev-control', optionId: scenario.id })),
        );
      for (const speed of [0, 1, 3] as const)
        dev.append(
          button(speed === 0 ? 'Пауза' : `×${speed}`, () =>
            this.send({ kind: 'dev-control', speed }),
          ),
        );
      dev.append(
        button('Проверить связь', () => this.send({ kind: 'dev-control', optionId: 'disconnect' })),
      );
      this.footer.append(dev);
    }
  }

  private send(input: CommandInput): void {
    if (this.connection.sendCommand(input) === null)
      this.say('Действие сейчас недоступно: нет подтверждённой связи или состояния.');
  }

  private beep(): void {
    if (this.volume <= 0) return;
    try {
      this.audio ??= new AudioContext();
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 590;
      gain.gain.value = this.volume * 0.09;
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(this.audio.currentTime + 0.13);
    } catch {
      /* Browsers can block audio until the first user gesture. Visual cue remains. */
    }
  }
}
