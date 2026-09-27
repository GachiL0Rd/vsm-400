import type { AcceptanceJournalInput, AvailableActionView } from '../../common';
import type { InteractionController } from '../input/interaction-controller';
import type { PresentationStore } from './presentation-store';

export class ActionOfferOverlay {
  private readonly root: HTMLDivElement;
  private unsubscribe: (() => void) | null = null;
  private openDialog: HTMLDialogElement | null = null;

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
        button.addEventListener('click', () => this.activate(action, interactions));
        this.root.append(button);
      }
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.openDialog?.remove();
    this.openDialog = null;
    this.root.remove();
  }

  private activate(action: AvailableActionView, interactions: InteractionController): void {
    const form = action.form;
    if (form?.kind === 'acceptance-journal') {
      this.showJournalForm(action.handle, form.value, interactions);
      return;
    }
    interactions.invokeAction(action.handle);
  }

  private showJournalForm(
    actionHandle: string,
    value: AcceptanceJournalInput,
    interactions: InteractionController,
  ): void {
    this.openDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'game-form-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Журнал приёмки';
    form.append(title);

    const communication = addTechnicalCheck(form, 'Связь с машинистом', value.communication);
    const extinguisher = addTechnicalCheck(form, 'Огнетушитель', value.extinguisher);
    const climate = addTechnicalCheck(form, 'Климат-контроль', value.climate);
    const emergencyBrake = addTechnicalCheck(form, 'Аварийный тормоз', value.emergencyBrake);
    const sanitation = addSelect(form, 'Санитарное состояние', value.sanitation, [
      ['unset', 'Не проверено'],
      ['clean', 'Чисто'],
      ['issue', 'Есть замечание'],
    ]);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Примечание';
    const note = document.createElement('textarea');
    note.maxLength = 1000;
    note.value = value.note;
    noteLabel.append(note);
    form.append(noteLabel);

    const acceptedLabel = document.createElement('label');
    const accepted = document.createElement('input');
    accepted.type = 'checkbox';
    accepted.checked = value.accepted;
    acceptedLabel.append(accepted, document.createTextNode(' Вагон принят'));
    form.append(acceptedLabel);

    const controls = document.createElement('div');
    controls.className = 'game-form-dialog__controls';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Отмена';
    cancel.addEventListener('click', () => dialog.close());
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Сохранить';
    controls.append(cancel, save);
    form.append(controls);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      interactions.invokeAction(actionHandle, {
        communication: technicalValue(communication.value),
        extinguisher: technicalValue(extinguisher.value),
        climate: technicalValue(climate.value),
        emergencyBrake: technicalValue(emergencyBrake.value),
        sanitation: sanitationValue(sanitation.value),
        note: note.value,
        accepted: accepted.checked,
      });
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.openDialog === dialog) this.openDialog = null;
    });
    dialog.append(form);
    document.body.append(dialog);
    this.openDialog = dialog;
    dialog.showModal();
  }
}

function addTechnicalCheck(
  parent: HTMLElement,
  label: string,
  value: AcceptanceJournalInput['communication'],
): HTMLSelectElement {
  return addSelect(parent, label, value, [
    ['unset', 'Не проверено'],
    ['ok', 'Норма'],
    ['problem', 'Проблема'],
  ]);
}

function addSelect<T extends string>(
  parent: HTMLElement,
  label: string,
  value: T,
  options: readonly (readonly [T, string])[],
): HTMLSelectElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const select = document.createElement('select');
  for (const [optionValue, text] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = text;
    option.selected = optionValue === value;
    select.append(option);
  }
  wrapper.append(select);
  parent.append(wrapper);
  return select;
}

function technicalValue(value: string): AcceptanceJournalInput['communication'] {
  if (value === 'unset' || value === 'ok' || value === 'problem') return value;
  throw new RangeError(`Unknown technical journal value ${value}`);
}

function sanitationValue(value: string): AcceptanceJournalInput['sanitation'] {
  if (value === 'unset' || value === 'clean' || value === 'issue') return value;
  throw new RangeError(`Unknown sanitation journal value ${value}`);
}
