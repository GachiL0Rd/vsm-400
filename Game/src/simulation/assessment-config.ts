import { z } from 'zod';
import type { ServiceClassTrait } from './entity-store';

const scoreDeltaSchema = z.object({
  safety: z.number().finite(),
  customerSatisfaction: z.number().finite(),
});

export const assessmentConfigSchema = z.object({
  schemaVersion: z.literal(1),
  setVersion: z.string().min(1),
  startingScore: z.number().finite(),
  boarding: z.object({
    unsafeAdmit: scoreDeltaSchema,
    wrongReject: scoreDeltaSchema,
  }),
  service: z.object({
    targetResponseUs: z.object({
      basic: z.number().int().positive(),
      comfort: z.number().int().positive(),
      business: z.number().int().positive(),
    }),
    timeoutPenalty: z.object({
      basic: z.number().nonnegative(),
      comfort: z.number().nonnegative(),
      business: z.number().nonnegative(),
    }),
    latePenalty: z.number().nonnegative(),
    veryLatePenalty: z.number().nonnegative(),
  }),
  incidents: z.object({
    criticalFire: scoreDeltaSchema,
    criticalPressure: scoreDeltaSchema,
  }),
  emergency: z.object({
    falseActivation: scoreDeltaSchema,
    sealRemovedWithoutActivation: scoreDeltaSchema,
  }),
  journal: z.object({
    falseCriticalReport: scoreDeltaSchema,
    missedCriticalProblem: scoreDeltaSchema,
  }),
  safePredepartureMinimumSafety: z.number().min(0).max(100),
  fastFireResponseUs: z.number().int().positive(),
});

export type AssessmentConfig = z.infer<typeof assessmentConfigSchema>;

export const BASELINE_ASSESSMENT_CONFIG: AssessmentConfig = assessmentConfigSchema.parse({
  schemaVersion: 1,
  setVersion: 'baseline-v2',
  startingScore: 100,
  boarding: {
    unsafeAdmit: { safety: -15, customerSatisfaction: 0 },
    wrongReject: { safety: 0, customerSatisfaction: -25 },
  },
  service: {
    targetResponseUs: {
      basic: 120_000_000,
      comfort: 90_000_000,
      business: 60_000_000,
    },
    timeoutPenalty: { basic: 10, comfort: 15, business: 20 },
    latePenalty: 5,
    veryLatePenalty: 10,
  },
  incidents: {
    criticalFire: { safety: -60, customerSatisfaction: -30 },
    criticalPressure: { safety: -50, customerSatisfaction: -25 },
  },
  emergency: {
    falseActivation: { safety: -20, customerSatisfaction: -20 },
    sealRemovedWithoutActivation: { safety: -5, customerSatisfaction: 0 },
  },
  journal: {
    falseCriticalReport: { safety: -10, customerSatisfaction: -40 },
    missedCriticalProblem: { safety: -30, customerSatisfaction: 0 },
  },
  safePredepartureMinimumSafety: 95,
  fastFireResponseUs: 120_000_000,
});

export function parseAssessmentConfig(input: unknown): AssessmentConfig {
  return assessmentConfigSchema.parse(input);
}

export function serviceClassValue(
  values: Readonly<Record<ServiceClassTrait, number>>,
  serviceClass: ServiceClassTrait,
): number {
  return values[serviceClass];
}
