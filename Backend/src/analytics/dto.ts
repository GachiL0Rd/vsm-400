import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CompetencySchema } from '../engine/schema';

const CellSchema = z.object({
  value: z.number().int(),
  weak: z.boolean(),
});

const CellsSchema = z.object({
  safety: CellSchema,
  procedure: CellSchema,
  detection: CellSchema,
  reaction: CellSchema,
  service: CellSchema,
  escalation: CellSchema,
});

export const HeatmapSchema = z
  .object({
    brigadeId: z.uuid(),
    code: z.string(),
    weakScore: z.number(),
    members: z.array(
      z.object({
        userId: z.uuid(),
        callsign: z.string(),
        position: z.string(),
        competencies: CellsSchema,
      }),
    ),
  })
  .meta({ id: 'BrigadeHeatmap' });

export class HeatmapDto extends createZodDto(HeatmapSchema) {}

export const GapsSchema = z
  .object({
    brigadeId: z.uuid(),
    weakScore: z.number(),
    failScore: z.number(),
    timeoutShare: z.number(),
    timeouts: z.number().int(),
    decisions: z.number().int(),
    safetyFails: z.object({
      runs: z.number().int(),
      failed: z.number().int(),
      share: z.number(),
    }),
    weak: z.array(
      z.object({
        competency: CompetencySchema,
        average: z.number().int(),
        members: z.number().int(),
        weakMembers: z.number().int(),
      }),
    ),
    hotspots: z.array(
      z.object({
        scenarioId: z.string(),
        title: z.string(),
        nodeId: z.string(),
        attempts: z.number().int(),
        errors: z.number().int(),
        errorShare: z.number(),
      }),
    ),
    recommendations: z.array(
      z.object({
        scenarioId: z.string(),
        title: z.string(),
        competencies: z.array(CompetencySchema),
        reason: z.string(),
      }),
    ),
  })
  .meta({ id: 'BrigadeGaps' });

export class GapsDto extends createZodDto(GapsSchema) {}

export const ScenarioFunnelSchema = z
  .object({
    scenarioId: z.string(),
    title: z.string(),
    decisions: z.number().int(),
    nodes: z.array(
      z.object({
        nodeId: z.string(),
        visits: z.number().int(),
        timeoutCount: z.number().int(),
        timeoutShare: z.number(),
        choices: z.array(
          z.object({
            choiceId: z.string(),
            count: z.number().int(),
            share: z.number(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'ScenarioFunnel' });

export class ScenarioFunnelDto extends createZodDto(ScenarioFunnelSchema) {}
