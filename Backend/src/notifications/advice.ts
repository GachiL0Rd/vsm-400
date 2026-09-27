import type { Competency } from '../generated/prisma/client';
import { competencyTitle } from './competency-label';

/** Что именно двигает компетенцию в фактах vsm-train2-01. */
const BEHAVIOUR: Record<Competency, string> = {
  safety: 'На рейсе это посадка, пожар, давление и стоп-кран.',
  procedure: 'На рейсе это журнал приёмки и решение о посадке.',
  detection: 'На рейсе это журнал приёмки без пропуска неисправности и без ложной отметки.',
  reaction: 'На рейсе это тушение пожара до критического и удержание давления.',
  service: 'На рейсе это запросы еды и воды, закрытые в срок.',
  escalation: 'На рейсе это удержание давления и стоп-кран только при опасности.',
};

export function adviceText(competency: Competency, mine: number, average: number): string {
  const label = competencyTitle(competency);
  return `${label} ниже среднего по депо — ${mine} из 100 при среднем ${average}. ${BEHAVIOUR[competency]}`;
}

export function adviceTitle(competency: Competency): string {
  return `${competencyTitle(competency)} ниже среднего по депо`;
}
