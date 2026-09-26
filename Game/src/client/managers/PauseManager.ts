import type { ConnectionStatus } from '../connection';
import { button } from '../dom';
import type { ObservableSnapshot } from '../protocol';

/** Dev speed controls. Only the server changes simulation time. */
export class PauseManager {
  readonly buttons: HTMLButtonElement[] = [];

  constructor(
    container: HTMLElement,
    private readonly send: (speed: 0 | 1 | 3) => void,
  ) {
    if (!import.meta.env.DEV) return;
    for (const speed of [0, 1, 3] as const) {
      const control = button(speed === 0 ? 'Пауза' : `×${speed}`, () => this.send(speed));
      control.dataset.speed = String(speed);
      this.buttons.push(control);
      container.insertBefore(control, container.querySelector('[data-disconnect]'));
    }
  }

  sync(snapshot: ObservableSnapshot | null, status: ConnectionStatus): void {
    for (const control of this.buttons) {
      control.disabled = status !== 'ready' || snapshot?.phase === 'finished';
      control.setAttribute(
        'aria-pressed',
        String(Number(control.dataset.speed) === snapshot?.controls?.speed),
      );
    }
  }

  destroy(): void {
    for (const control of this.buttons) control.remove();
  }
}
