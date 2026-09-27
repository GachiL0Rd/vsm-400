import type { ConnectionState, PresentationStore } from './presentation-store';

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Подключение',
  connected: 'Связь есть',
  disconnected: 'Нет связи',
  reconnecting: 'Переподключение',
  error: 'Ошибка связи',
};

/** Connection pill hosted by the HUD time bar. */
export class ConnectionStatus {
  private readonly root: HTMLParagraphElement;
  private readonly text: HTMLSpanElement;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, store: PresentationStore) {
    this.root = document.createElement('p');
    this.root.className = 'hud-connection';
    const dot = document.createElement('span');
    dot.className = 'hud-connection__dot';
    dot.setAttribute('aria-hidden', 'true');
    this.text = document.createElement('span');
    this.text.className = 'hud-connection__text';
    this.root.append(dot, this.text);
    parent.prepend(this.root);
    this.unsubscribe = store.subscribe((state) => {
      this.root.dataset.state = state.connection;
      this.text.textContent = CONNECTION_LABELS[state.connection];
      if (state.lastError === null) this.root.removeAttribute('title');
      else this.root.title = state.lastError.message;
    });
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
