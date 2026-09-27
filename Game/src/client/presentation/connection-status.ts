import type { PresentationStore } from './presentation-store';

export class ConnectionStatus {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, store: PresentationStore) {
    this.root = document.createElement('div');
    this.root.className = 'connection-status';
    parent.append(this.root);
    store.subscribe((state) => {
      this.root.textContent = state.lastError
        ? `${state.connection}: ${state.lastError.message}`
        : state.connection;
    });
  }
}
