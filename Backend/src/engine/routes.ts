import { z } from 'zod';
import { CarClassSchema, StageSchema } from './schema';

const ClockSchema = z.string().regex(/^\d{2}:\d{2}$/);

/**
 * Справочник рейса. Движок файл не читает: yaml грузит вызывающий код
 * и передаёт объект в generateShift. Класс вагона задаётся здесь, не в коде.
 */
export const RoutesSchema = z
  .strictObject({
    trainPrefix: z.string().min(1),
    trainNumberMin: z.number().int(),
    trainNumberMax: z.number().int(),
    directions: z
      .array(
        z.strictObject({
          from: z.string().min(1),
          to: z.string().min(1),
          stops: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
    cars: z
      .array(
        z.strictObject({
          car: z.number().int().min(1).max(8),
          class: CarClassSchema,
        }),
      )
      .min(1),
    departures: z.array(ClockSchema).min(1),
    stageOrder: z.array(StageSchema).min(1),
    stageClockOffsetMin: z.strictObject({
      acceptance: z.number().int(),
      boarding: z.number().int(),
      enroute: z.number().int(),
      stop: z.number().int(),
      handover: z.number().int(),
    }),
    sameStageGapMin: z.number().int().positive(),
    nodeStepMin: z.number().int().positive(),
  })
  .refine((value) => value.trainNumberMin <= value.trainNumberMax, {
    message: 'trainNumberMin больше trainNumberMax',
  });

export type Routes = z.infer<typeof RoutesSchema>;
