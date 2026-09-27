import { EngineError } from '../engine/errors';
import { isEndNode, type ScenarioGraph, type ScenarioNode } from '../engine/schema';
import type { EngineState, ShiftPlan } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { PublicPlan } from './dto';

export type StoredState = EngineState & { shownAt: string };

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function attachShown(state: EngineState, shownAt: Date): StoredState {
  return { ...state, shownAt: shownAt.toISOString() };
}

export function readPlan(raw: unknown): ShiftPlan {
  if (!isRecord(raw) || !Array.isArray(raw.scenarios)) {
    throw new Error('План сессии повреждён');
  }
  return {
    train: readString(raw.train),
    route: readString(raw.route),
    fromStation: readString(raw.fromStation),
    toStation: readString(raw.toStation),
    stops: readStrings(raw.stops),
    car: readInt(raw.car),
    carClass: readCarClass(raw.carClass),
    departure: readString(raw.departure),
    scenarios: raw.scenarios.map(readPlanned),
  };
}

export function toPublicPlan(plan: ShiftPlan, titles: readonly string[]): PublicPlan {
  return {
    train: plan.train,
    route: plan.route,
    car: plan.car,
    carClass: plan.carClass,
    departure: plan.departure,
    segments: plan.scenarios.length,
    titles: titles.slice(),
  };
}

export function deadlineFor(node: ScenarioNode, now: Date): Date | null {
  if (isEndNode(node) || typeof node.timer !== 'number') {
    return null;
  }
  return new Date(now.getTime() + node.timer * 1000);
}

export function currentGraph(state: EngineState, graphs: readonly ScenarioGraph[]): ScenarioGraph {
  const graph = graphs.find((item) => item.id === state.scenarioId);
  if (!graph) {
    throw new EngineError('SCENARIO_MISSING');
  }
  return graph;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readCarClass(value: unknown): ShiftPlan['carClass'] {
  if (value === 'ECONOMY' || value === 'FAMILY' || value === 'BUSINESS' || value === 'FIRST') {
    return value;
  }
  throw new Error('План сессии повреждён');
}

function readPlanned(value: unknown): ShiftPlan['scenarios'][number] {
  if (!isRecord(value)) {
    throw new Error('План сессии повреждён');
  }
  return {
    scenarioId: readString(value.scenarioId),
    version: readInt(value.version),
    params: readParams(value.params),
  };
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('План сессии повреждён');
  }
  return value;
}

function readInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Состояние сессии повреждено');
  }
  return value;
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const list: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      list.push(item);
    }
  }
  return list;
}

function readParams(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const params: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === 'number' && Number.isFinite(item)) {
      params[key] = item;
    }
  }
  return params;
}
