import {
  type ClientCommand,
  GAME_PROTOCOL_VERSION,
  type InvokeActionCommand,
  type PublicTargetRef,
} from '../../common';
import type { PresentationStore } from '../presentation/presentation-store';

export class InteractionController {
  private requestSequence = 0;

  constructor(
    private readonly store: PresentationStore,
    private readonly send: (command: ClientCommand) => void,
  ) {}

  moveTo(targetCellId: string): void {
    const revision = this.store.snapshot.revision;
    if (revision === null) return;
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      targetCellId,
    });
  }

  queryActions(target: PublicTargetRef): void {
    this.store.clearActionOffer();
    const revision = this.store.snapshot.revision;
    if (revision === null) return;
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      target,
    });
  }

  invokeAction(actionHandle: string, input?: InvokeActionCommand['input']): void {
    const revision = this.store.snapshot.revision;
    const offer = this.store.snapshot.currentOffer;
    if (revision === null || offer === null || offer.revision !== revision) return;
    if (!offer.actions.some((action) => action.handle === actionHandle)) return;
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'invoke-action',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      actionHandle,
      ...(input === undefined ? {} : { input }),
    });
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `client-${this.requestSequence}`;
  }
}
