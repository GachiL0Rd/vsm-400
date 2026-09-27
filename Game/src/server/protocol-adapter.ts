/**
 * Transport boundary only. The future common/protocol patch owns framing,
 * validation, hello semantics and public DTOs.
 */
export interface GameProtocolConnection {
  readonly id: string;
  onMessage(listener: (data: string | Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(code: number, reason: string): void;
}

export interface GameProtocolAdapter {
  open(connection: GameProtocolConnection): void;
}

/** Safe production default until a common-wire adapter is supplied. */
export class RejectingProtocolAdapter implements GameProtocolAdapter {
  open(connection: GameProtocolConnection): void {
    connection.close(1008, 'Game protocol adapter is not configured');
  }
}
