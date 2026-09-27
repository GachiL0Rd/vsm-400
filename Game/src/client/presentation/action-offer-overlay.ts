import type { InteractionController } from '../input/interaction-controller';
import type { PresentationStore } from './presentation-store';

export class ActionOfferOverlay {
  private readonly root: HTMLDivElement;
  private unsubscribe: (() => void) | null = null;

  constructor(parent: HTMLElement, store: PresentationStore, interactions: InteractionController) {
    this.root = document.createElement('div');
    this.root.className = 'action-offer-overlay';
    parent.append(this.root);
    this.unsubscribe = store.subscribe((state) => {
      this.root.replaceChildren();
      const offer = state.currentOffer;
      if (offer === null || offer.revision !== state.revision) return;
      for (const action of offer.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.addEventListener('click', () => interactions.invokeAction(action.handle));
        this.root.append(button);
      }
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root.remove();
  }
}
