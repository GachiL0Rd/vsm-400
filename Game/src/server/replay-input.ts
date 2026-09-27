import { z } from 'zod';
import {
  acceptanceJournalInputSchema,
  climateControlInputSchema,
  emergencyBrakeInputSchema,
  extinguisherInspectionInputSchema,
  passengerBoardingInputSchema,
} from '../common/game-wire.ts';
import type { RecordedGameplayCommand } from '../projection/public-game-session.ts';

const idSchema = z.string().min(1);

export const recordedGameplayCommandSchema: z.ZodType<RecordedGameplayCommand> =
  z.discriminatedUnion('kind', [
    // Legacy direct-edge record remains accepted for existing replay artifacts.
    z.object({ kind: z.literal('move'), edgeId: idSchema }).strict(),
    z.object({ kind: z.literal('move-to'), targetCellId: idSchema }).strict(),
    z.object({ kind: z.literal('take-consumable'), itemKind: z.enum(['food', 'drink']) }).strict(),
    z.object({ kind: z.literal('give-held-item'), targetId: idSchema }).strict(),
    z.object({ kind: z.literal('take-journal') }).strict(),
    z.object({ kind: z.literal('edit-journal'), value: acceptanceJournalInputSchema }).strict(),
    z.object({ kind: z.literal('return-journal') }).strict(),
    z.object({ kind: z.literal('take-extinguisher') }).strict(),
    z
      .object({ kind: z.literal('inspect-extinguisher'), value: extinguisherInspectionInputSchema })
      .strict(),
    z.object({ kind: z.literal('return-extinguisher') }).strict(),
    z.object({ kind: z.literal('use-extinguisher'), targetId: idSchema }).strict(),
    z.object({ kind: z.literal('inspect-climate'), value: climateControlInputSchema }).strict(),
    z
      .object({ kind: z.literal('inspect-emergency-brake'), value: emergencyBrakeInputSchema })
      .strict(),
    z
      .object({
        kind: z.literal('decide-passenger-boarding'),
        targetId: idSchema,
        value: passengerBoardingInputSchema,
      })
      .strict(),
  ]);

const recordedUserInputSchema = z
  .object({
    at: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    command: recordedGameplayCommandSchema,
  })
  .strict();

export type RecordedReplayInput = z.infer<typeof recordedUserInputSchema>;

export function parseReplayInputs(input: readonly unknown[]): readonly RecordedReplayInput[] {
  const parsed = z.array(recordedUserInputSchema).parse(input);
  let previous: RecordedReplayInput | undefined;
  for (const current of parsed) {
    if (
      previous !== undefined &&
      (current.at < previous.at ||
        (current.at === previous.at && current.sequence <= previous.sequence))
    ) {
      throw new RangeError(
        'Replay user inputs must be strictly ordered by simulation time and sequence',
      );
    }
    previous = current;
  }
  return parsed;
}
