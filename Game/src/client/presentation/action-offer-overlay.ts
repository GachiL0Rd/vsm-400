import type {
  AcceptanceJournalInput,
  AvailableActionView,
  ClimateControlValue,
  EmergencyBrakeValue,
  ExtinguisherInspectionValue,
  PassengerDocumentsValue,
} from '../../common';
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
    if (form?.kind === 'extinguisher-inspection') {
      this.showExtinguisherForm(action.handle, form.value, interactions);
      return;
    }
    if (form?.kind === 'climate-control') {
      this.showClimateForm(action.handle, form.value, interactions);
      return;
    }
    if (form?.kind === 'emergency-brake') {
      this.showEmergencyBrakeForm(action.handle, form.value, interactions);
      return;
    }
    if (form?.kind === 'passenger-documents') {
      this.showPassengerDocumentsForm(action.handle, form.value, interactions);
      return;
    }
    interactions.invokeAction(action.handle);
  }

  private showPassengerDocumentsForm(
    actionHandle: string,
    value: PassengerDocumentsValue,
    interactions: InteractionController,
  ): void {
    this.openDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'game-form-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Документы пассажира';
    form.append(title);

    const ticketTitle = document.createElement('h3');
    ticketTitle.textContent = 'Билет';
    form.append(ticketTitle);
    const ticketRows: readonly [string, string][] = [
      ['Пассажир', value.ticket.passengerName],
      ['Поезд', value.ticket.train],
      ['Дата', value.ticket.date],
      ['Отправление', value.ticket.departureTime],
      ['Вагон', value.ticket.carriage],
      ['Место', value.ticket.seat],
      ['Документ', `${value.ticket.documentType} ${value.ticket.documentNumberMasked}`],
      ['Маршрут', value.ticket.route ?? '—'],
    ];
    for (const [label, text] of ticketRows) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${text}`;
      form.append(row);
    }

    const identityTitle = document.createElement('h3');
    identityTitle.textContent = value.identity.type === 'passport' ? 'Паспорт' : 'Удостоверение';
    form.append(identityTitle);
    const identityRows: readonly [string, string][] = [
      ['Имя', value.identity.passengerName],
      ['Дата рождения', value.identity.birthDate],
      ['Номер', value.identity.numberMasked],
      ['Класс обслуживания', value.serviceClass],
    ];
    for (const [label, text] of identityRows) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${text}`;
      form.append(row);
    }

    const controls = document.createElement('div');
    controls.className = 'game-form-dialog__controls';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dialog.close());
    controls.append(close);

    if (value.canReject) {
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Отказать';
      reject.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { decision: 'reject' });
        dialog.close();
      });
      controls.append(reject);
    }
    if (value.canAdmit) {
      const admit = document.createElement('button');
      admit.type = 'button';
      admit.textContent = 'Допустить';
      admit.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { decision: 'admit' });
        dialog.close();
      });
      controls.append(admit);
    }
    form.append(controls);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.openDialog === dialog) this.openDialog = null;
    });
    dialog.append(form);
    document.body.append(dialog);
    this.openDialog = dialog;
    dialog.showModal();
  }

  private showEmergencyBrakeForm(
    actionHandle: string,
    value: EmergencyBrakeValue,
    interactions: InteractionController,
  ): void {
    this.openDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'game-form-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Аварийный тормоз';
    form.append(title);

    const seal = document.createElement('p');
    seal.textContent = `Пломба: ${value.seal === 'intact' ? 'цела' : 'сорвана'}`;
    const state = document.createElement('p');
    state.textContent = `Состояние: ${value.activated ? 'активирован' : 'не активирован'}`;
    form.append(seal, state);

    const controls = document.createElement('div');
    controls.className = 'game-form-dialog__controls';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dialog.close());
    controls.append(close);

    if (value.canRemoveSeal) {
      const removeSeal = document.createElement('button');
      removeSeal.type = 'button';
      removeSeal.textContent = 'Снять пломбу';
      removeSeal.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { action: 'remove-seal' });
        dialog.close();
      });
      controls.append(removeSeal);
    }
    if (value.canActivate) {
      const activate = document.createElement('button');
      activate.type = 'button';
      activate.textContent = 'Активировать аварийный тормоз';
      activate.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { action: 'activate' });
        dialog.close();
      });
      controls.append(activate);
    }
    form.append(controls);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.openDialog === dialog) this.openDialog = null;
    });
    dialog.append(form);
    document.body.append(dialog);
    this.openDialog = dialog;
    dialog.showModal();
  }

  private showClimateForm(
    actionHandle: string,
    value: ClimateControlValue,
    interactions: InteractionController,
  ): void {
    this.openDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'game-form-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Климат-контроль';
    form.append(title);

    const rows: readonly [string, string][] = [
      ['Связь', value.connection === 'connected' ? 'Есть' : 'Нет'],
      ['Температура', `${value.temperatureC.toFixed(1)} °C`],
      ['Давление', `${value.pressureKPa.toFixed(1)} кПа`],
      ['Датчик дыма', value.smokeDetected ? 'Дым обнаружен' : 'Норма'],
      ['Последнее обновление', `${(value.updatedAt / 1_000_000).toFixed(0)} с`],
    ];
    for (const [label, text] of rows) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${text}`;
      form.append(row);
    }

    const controls = document.createElement('div');
    controls.className = 'game-form-dialog__controls';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dialog.close());
    controls.append(close);
    if (value.canRefresh) {
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = 'Обновить данные';
      refresh.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { refresh: true });
        dialog.close();
      });
      controls.append(refresh);
    }
    form.append(controls);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.openDialog === dialog) this.openDialog = null;
    });
    dialog.append(form);
    document.body.append(dialog);
    this.openDialog = dialog;
    dialog.showModal();
  }

  private showExtinguisherForm(
    actionHandle: string,
    value: ExtinguisherInspectionValue,
    interactions: InteractionController,
  ): void {
    this.openDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'game-form-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const title = document.createElement('h2');
    title.textContent = 'Огнетушитель';
    form.append(title);

    const rows: readonly [string, string][] = [
      ['Чека', value.pin === 'present' ? 'На месте' : 'Снята'],
      ['Пломба', value.seal === 'intact' ? 'Цела' : 'Сорвана'],
      ['Давление', value.pressure],
      ['Корпус', value.bodyDamage],
      ['Использован', value.used ? 'Да' : 'Нет'],
    ];
    for (const [label, text] of rows) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${text}`;
      form.append(row);
    }

    const controls = document.createElement('div');
    controls.className = 'game-form-dialog__controls';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dialog.close());
    controls.append(close);
    if (value.canRemovePin) {
      const removePin = document.createElement('button');
      removePin.type = 'button';
      removePin.textContent = 'Снять чеку';
      removePin.addEventListener('click', () => {
        interactions.invokeAction(actionHandle, { removePin: true });
        dialog.close();
      });
      controls.append(removePin);
    }
    form.append(controls);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (this.openDialog === dialog) this.openDialog = null;
    });
    dialog.append(form);
    document.body.append(dialog);
    this.openDialog = dialog;
    dialog.showModal();
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
