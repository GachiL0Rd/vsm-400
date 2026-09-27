import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RUN_COMPLETED,
  type RunCompletedPayload,
  SESSION_TEXT_REQUESTED,
  type SessionTextRequestedPayload,
} from '../common/events';
import { VariantPoolService } from './variant-pool.service';

@Injectable()
export class LlmSessionListener {
  private readonly logger = new Logger(LlmSessionListener.name);

  constructor(@Inject(VariantPoolService) private readonly pool: VariantPoolService) {}

  @OnEvent(SESSION_TEXT_REQUESTED, { async: true })
  async onTextRequested(payload: SessionTextRequestedPayload): Promise<void> {
    for (const item of payload.items) {
      await this.pool.enqueueLive(
        payload.sessionId,
        [{ scenarioId: item.scenarioId, version: item.version, nodeId: item.nodeId }],
        item.persona,
      );
    }
  }

  @OnEvent(RUN_COMPLETED, { async: true })
  async onRunCompleted(payload: RunCompletedPayload): Promise<void> {
    try {
      await this.pool.releaseSession(payload.sessionId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`не отпустить варианты сессии ${payload.sessionId}: ${text}`);
    }
  }
}
