import { COMPETENCY_IDS, COMPETENCY_TITLES } from '../cabinet/competencies';
import type { Competency } from '../engine/schema';
import { ratio } from './ratio';

export type MemberScores = { scores: Record<Competency, number> };

export type HotspotInput = {
  scenarioId: string;
  title: string;
  nodeId: string;
  attempts: number;
  errors: number;
};

export type ScenarioBrief = {
  id: string;
  title: string;
  competencies: Competency[];
  status: string;
};

const HOTSPOT_LIMIT = 10;
const RECOMMENDATION_LIMIT = 5;

export function buildGaps(input: {
  brigadeId: string;
  weakScore: number;
  failScore: number;
  members: readonly MemberScores[];
  runs: number;
  safetyFails: number;
  decisions: number;
  timeouts: number;
  hotspots: readonly HotspotInput[];
  scenarios: readonly ScenarioBrief[];
}) {
  const weak = weakZones(input.members, input.weakScore);
  return {
    brigadeId: input.brigadeId,
    weakScore: input.weakScore,
    failScore: input.failScore,
    timeoutShare: ratio(input.timeouts, input.decisions),
    timeouts: input.timeouts,
    decisions: input.decisions,
    safetyFails: {
      runs: input.runs,
      failed: input.safetyFails,
      share: ratio(input.safetyFails, input.runs),
    },
    weak,
    hotspots: rankHotspots(input.hotspots),
    recommendations: recommend(
      input.scenarios,
      weak.map((item) => item.competency),
    ),
  };
}

function weakZones(members: readonly MemberScores[], weakScore: number) {
  const zones = [];
  for (const competency of COMPETENCY_IDS) {
    const zone = zoneFor(competency, members, weakScore);
    if (zone.average < weakScore) {
      zones.push(zone);
    }
  }
  return zones;
}

function zoneFor(competency: Competency, members: readonly MemberScores[], weakScore: number) {
  let sum = 0;
  let weakMembers = 0;
  for (const member of members) {
    const value = member.scores[competency];
    sum += value;
    if (value < weakScore) {
      weakMembers += 1;
    }
  }
  const average = members.length === 0 ? weakScore : Math.round(sum / members.length);
  return { competency, average, members: members.length, weakMembers };
}

function rankHotspots(hotspots: readonly HotspotInput[]) {
  const ordered = [...hotspots];
  ordered.sort(
    (left, right) =>
      right.errors - left.errors ||
      right.attempts - left.attempts ||
      left.nodeId.localeCompare(right.nodeId),
  );
  const top = ordered.slice(0, HOTSPOT_LIMIT);
  const view = [];
  for (const spot of top) {
    if (spot.errors === 0) {
      continue;
    }
    view.push({
      scenarioId: spot.scenarioId,
      title: spot.title,
      nodeId: spot.nodeId,
      attempts: spot.attempts,
      errors: spot.errors,
      errorShare: ratio(spot.errors, spot.attempts),
    });
  }
  return view;
}

function recommend(scenarios: readonly ScenarioBrief[], weak: readonly Competency[]) {
  const ranked: { id: string; title: string; competencies: Competency[]; overlap: Competency[] }[] =
    [];
  for (const scenario of scenarios) {
    if (scenario.status !== 'PUBLISHED') {
      continue;
    }
    const overlap = overlapOf(scenario.competencies, weak);
    if (overlap.length === 0) {
      continue;
    }
    ranked.push({
      id: scenario.id,
      title: scenario.title,
      competencies: scenario.competencies,
      overlap,
    });
  }
  ranked.sort(
    (left, right) => right.overlap.length - left.overlap.length || left.id.localeCompare(right.id),
  );
  const view = [];
  for (const scenario of ranked.slice(0, RECOMMENDATION_LIMIT)) {
    const titles = scenario.overlap.map((id) => COMPETENCY_TITLES[id]);
    view.push({
      scenarioId: scenario.id,
      title: scenario.title,
      competencies: scenario.competencies,
      reason: `Закрывает просадку: ${titles.join(', ')}`,
    });
  }
  return view;
}

function overlapOf(competencies: readonly Competency[], weak: readonly Competency[]): Competency[] {
  const found: Competency[] = [];
  for (const id of competencies) {
    if (weak.includes(id)) {
      found.push(id);
    }
  }
  return found;
}
