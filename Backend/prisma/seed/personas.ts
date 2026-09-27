import type { FinishedGameResult } from '../../src/sessions/platform.dto';

export const DEMO_LOGINS = ['demo1', 'demo2', 'demo3', 'demo4', 'demo5'] as const;

export type DemoLogin = (typeof DEMO_LOGINS)[number];

export const SEED_MARKER: DemoLogin = 'demo1';

export type FixtureBand =
  | 'careful'
  | 'late'
  | 'timeout'
  | 'unsafe-admit'
  | 'wrong-reject'
  | 'false-journal'
  | 'missed-fault'
  | 'fire-missed'
  | 'pressure-critical'
  | 'false-brake'
  | 'safe-stop';

export type PersonaAssignment = {
  login: DemoLogin;
  callsign: string;
  grade: 'TRAINEE' | 'CONDUCTOR' | 'CONDUCTOR_SENIOR';
  spanDays: number;
  streak: number;
  fixtureIndexes: number[];
};

const SCRIPT: Record<DemoLogin, readonly FixtureBand[]> = {
  demo1: [
    'false-journal',
    'missed-fault',
    'unsafe-admit',
    'wrong-reject',
    'timeout',
    'timeout',
    'fire-missed',
    'pressure-critical',
    'late',
    'late',
    'false-brake',
    'careful',
    'safe-stop',
    'careful',
    'late',
    'careful',
  ],
  demo2: [
    'careful',
    'safe-stop',
    'careful',
    'careful',
    'safe-stop',
    'late',
    'careful',
    'safe-stop',
    'careful',
    'careful',
    'safe-stop',
    'careful',
    'safe-stop',
    'careful',
  ],
  demo3: [
    'late',
    'careful',
    'timeout',
    'unsafe-admit',
    'late',
    'wrong-reject',
    'careful',
    'timeout',
    'late',
    'safe-stop',
    'careful',
    'late',
  ],
  demo4: [
    'fire-missed',
    'false-journal',
    'pressure-critical',
    'unsafe-admit',
    'missed-fault',
    'false-brake',
    'wrong-reject',
    'fire-missed',
    'timeout',
    'pressure-critical',
    'false-brake',
    'unsafe-admit',
  ],
  demo5: ['careful', 'late', 'timeout', 'careful'],
};

const PROFILE: Record<
  DemoLogin,
  Pick<PersonaAssignment, 'callsign' | 'grade' | 'spanDays' | 'streak'>
> = {
  demo1: { callsign: 'LUCH', grade: 'CONDUCTOR', spanDays: 42, streak: 5 },
  demo2: { callsign: 'VOLK', grade: 'CONDUCTOR_SENIOR', spanDays: 40, streak: 6 },
  demo3: { callsign: 'OREL', grade: 'CONDUCTOR', spanDays: 36, streak: 2 },
  demo4: { callsign: 'ISKR', grade: 'CONDUCTOR', spanDays: 42, streak: 1 },
  demo5: { callsign: 'SMEN', grade: 'TRAINEE', spanDays: 8, streak: 2 },
};

type Fact = NonNullable<FinishedGameResult['assessment']>['facts'][number];

export function bandOf(result: FinishedGameResult): FixtureBand {
  const facts: readonly Fact[] = result.assessment?.facts ?? [];
  const journal = facts.find((fact) => fact.kind === 'journal-submission');
  const brake = facts.find((fact) => fact.kind === 'emergency-brake');
  const fire = facts.find((fact) => fact.kind === 'fire');
  const pressure = facts.find((fact) => fact.kind === 'pressure');
  if (journal?.detail.missedProblem === true) {
    return 'missed-fault';
  }
  if (journal?.detail.falseReport === true && facts.length === 1) {
    return 'false-journal';
  }
  if (pressure?.verdict === 'missed') {
    return 'pressure-critical';
  }
  if (brake?.verdict === 'correct' && brake.detail.hazardActive === true) {
    return 'safe-stop';
  }
  if (brake?.detail.activated === true && brake.detail.hazardActive === false) {
    return 'false-brake';
  }
  if (fire?.verdict === 'missed' && result.termination.outcomeId === 'wagon-unsalvageable') {
    return 'fire-missed';
  }
  if (boardingMismatch(facts, 'admit', 'reject')) {
    return 'unsafe-admit';
  }
  if (boardingMismatch(facts, 'reject', 'admit')) {
    return 'wrong-reject';
  }
  if (facts.some((fact) => fact.kind === 'service-request' && fact.verdict === 'missed')) {
    return 'timeout';
  }
  if (facts.some((fact) => fact.kind === 'service-request' && fact.verdict === 'late')) {
    return 'late';
  }
  return 'careful';
}

export function assignPersonas(results: readonly FinishedGameResult[]): PersonaAssignment[] {
  const pools = new Map<FixtureBand, number[]>();
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result) {
      continue;
    }
    const band = bandOf(result);
    const list = pools.get(band) ?? [];
    list.push(index);
    pools.set(band, list);
  }
  const cursor = new Map<FixtureBand, number>();
  return DEMO_LOGINS.map((login) => {
    const script = SCRIPT[login];
    const profile = PROFILE[login];
    return {
      login,
      ...profile,
      fixtureIndexes: script.map((band) => take(pools, cursor, band)),
    };
  });
}

function take(
  pools: ReadonlyMap<FixtureBand, number[]>,
  cursor: Map<FixtureBand, number>,
  band: FixtureBand,
): number {
  const list = pools.get(band);
  if (!list || list.length === 0) {
    throw new Error(`Нет фикстуры для политики ${band}`);
  }
  const at = cursor.get(band) ?? 0;
  cursor.set(band, at + 1);
  const index = list[at % list.length];
  if (index === undefined) {
    throw new Error(`Пустой пул ${band}`);
  }
  return index;
}

function boardingMismatch(facts: readonly Fact[], actual: string, expected: string): boolean {
  return facts.some(
    (fact) =>
      fact.kind === 'boarding-decision' &&
      fact.detail.actual === actual &&
      fact.detail.expected === expected,
  );
}
