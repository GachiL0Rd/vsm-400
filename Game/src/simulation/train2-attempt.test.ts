import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ActionContent } from './action-decision.ts';
import { loadActionContent } from './action-decision.ts';
import type { AssessmentResult } from './assessment.ts';
import { parseAssessmentConfig } from './assessment-config.ts';
import { GameAttempt } from './game-attempt.ts';
import { loadLevelDefinition } from './level.ts';
import { loadScenarioDefinition } from './scenario.ts';
import { secondsToSimTimeUs } from './sim-time.ts';

const contentDirectory = new URL('../../content/vsm-train2-01/', import.meta.url);

function readContent(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, contentDirectory), 'utf8'));
}

const level = loadLevelDefinition(readContent('level.json'));
const scenario = loadScenarioDefinition(readContent('scenario.json'), level);
const actions = readContent('actions.json') as ActionContent;
loadActionContent(actions);
const assessment = parseAssessmentConfig(readContent('assessment.json'));

function createAttempt(rootSeed: number): GameAttempt {
  return new GameAttempt({
    rootSeed,
    level,
    scenario,
    actionContent: actions,
    assessmentConfig: assessment,
  });
}

function walkTo(attempt: GameAttempt, cellId: string): void {
  const current = attempt.playerPosition();
  if (current.kind === 'cell' && current.cellId === cellId) return;
  attempt.movePlayerTo(cellId);
  const limit = attempt.time + 120_000_000;
  while (attempt.time < limit) {
    const position = attempt.playerPosition();
    if (position.kind === 'cell' && position.cellId === cellId) return;
    attempt.advanceTo(Math.min(limit, attempt.time + 250_000));
  }
  throw new Error(`Player did not reach ${cellId}`);
}

function completeJournal(attempt: GameAttempt): void {
  attempt.takeJournal();
  attempt.editJournal({
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
  });
  attempt.returnJournal();
}

describe('vsm-train2-01 attempt', () => {
  it('walks platform, door, aisle, and service point, then takes the extinguisher on its cell', () => {
    const attempt = createAttempt(1);
    expect(attempt.playerPosition()).toEqual({ kind: 'cell', cellId: 'platform-origin.x-3y8' });

    const route = attempt.level.grid.route(
      'platform-origin.x-3y8',
      'carriage.x69y8',
      attempt.level.constraintsFor(['carriage-main', 'platform-origin']),
    );
    expect(route?.cells).toEqual(
      expect.arrayContaining([
        'platform-origin.x-1y8',
        'carriage.x7y8',
        'carriage.x66y8',
        'carriage.x69y8',
      ]),
    );
    expect(route?.edgeIds.some((edgeId) => edgeId.endsWith(':door'))).toBe(true);

    walkTo(attempt, 'carriage.x69y8');
    expect(() => attempt.takeExtinguisher()).toThrow(/not at the item/);
    walkTo(attempt, 'carriage.x68y8');
    expect(() => attempt.takeExtinguisher()).toThrow(/not at the item/);
    walkTo(attempt, 'carriage.x67y8');
    expect(attempt.takeExtinguisher().location).toBe('held');
    attempt.returnExtinguisher();
    walkTo(attempt, 'carriage.x69y8');
    attempt.takeDrink();
    expect(attempt.entities.get('player').heldItemId).toBe('drink-1');
  });

  it('boards passengers onto real seats and repeats the same run', () => {
    const play = () => {
      const attempt = createAttempt(17);
      completeJournal(attempt);
      attempt.advanceTo(secondsToSimTimeUs(5 * 60));
      walkTo(attempt, 'platform-origin.x-2y8');
      expect(attempt.decidePassengerBoarding('passenger-1', 'admit')).toBe('admit');
      expect(attempt.entities.get('passenger-1').position).toEqual({
        kind: 'cell',
        cellId: 'carriage.seat.bay_02_far_L',
      });
      expect(attempt.decidePassengerBoarding('passenger-2', 'admit')).toBe('admit');
      expect(attempt.entities.get('passenger-2').position).toEqual({
        kind: 'cell',
        cellId: 'carriage.seat.bay_06_near_R',
      });
      attempt.decidePassengerBoarding('passenger-3', 'reject');
      expect(() => attempt.entities.get('passenger-3')).toThrow(/Unknown entity/);

      walkTo(attempt, 'carriage.x67y8');
      attempt.takeExtinguisher();
      attempt.prepareExtinguisher();
      walkTo(attempt, 'carriage.x41y8');
      const fireAt = secondsToSimTimeUs(45 * 60);
      attempt.advanceTo(fireAt);
      expect(() => attempt.useExtinguisher('fire:carriage.x39y8')).toThrow(
        /outside interaction range/,
      );
      walkTo(attempt, 'carriage.x40y8');
      attempt.useExtinguisher('fire:carriage.x39y8');
      attempt.advanceTo(attempt.scenario.normalEndTimeUs);
      return {
        termination: attempt.termination,
        assessment: attempt.assessmentResult(),
      };
    };

    const first = play();
    expect(first).toEqual(play());
    expect(first.termination).toEqual({
      kind: 'route-completed',
      at: scenario.normalEndTimeUs,
    });
    const fire = fact(first.assessment, 'fire:cabin-fire');
    const pressure = fact(first.assessment, 'pressure:entry-pressure-leak');
    expect(fire).toMatchObject({
      verdict: 'correct',
      detail: { incidentId: 'cabin-fire', extinguished: true, critical: false },
    });
    expect(pressure).toMatchObject({
      verdict: 'correct',
      detail: { incidentId: 'entry-pressure-leak', critical: false },
    });
  }, 20_000);
});

function fact(result: AssessmentResult, id: string): AssessmentResult['facts'][number] | undefined {
  return result.facts.find((item) => item.id === id);
}
