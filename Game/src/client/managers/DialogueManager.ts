import type { CommandInput } from '../connection';
import { addLine, button, node } from '../dom';
import type { DialogueView } from '../protocol';

/** Owns the visible dialogue and document comparison card. */
export class DialogueManager {
  private dismissedDialogue: string | null = null;
  private lastDialogue: DialogueView | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly send: (input: CommandInput) => void,
  ) {}

  sync(dialogue: DialogueView | null): void {
    if (dialogue === this.lastDialogue) return;
    this.dismissedDialogue = null;
    this.lastDialogue = dialogue;
    this.render();
  }

  reset(): void {
    this.dismissedDialogue = null;
    this.lastDialogue = null;
    this.root.replaceChildren();
  }

  destroy(): void {
    this.reset();
  }

  private render(): void {
    this.root.replaceChildren();
    const active = this.lastDialogue;
    if (active === null || this.dismissedDialogue === active.id) return;
    this.root.append(node('h2', '', active.title));
    for (const line of active.lines) addLine(this.root, line, 'dialogue-line');
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
      this.root.append(cards);
    }
    for (const option of active.options) {
      this.root.append(
        button(
          option.enabled
            ? option.label
            : `${option.label} · ${option.disabledReason ?? 'недоступно'}`,
          () => this.send({ kind: 'dialogue-choice', targetId: active.npcId, optionId: option.id }),
          !option.enabled,
        ),
      );
    }
    this.root.append(
      button('Закрыть окно', () => {
        this.dismissedDialogue = active.id;
        this.root.replaceChildren();
      }),
    );
  }
}
