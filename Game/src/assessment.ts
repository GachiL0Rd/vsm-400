import type { FireIncidentState } from './incident';
import type { PassengerState } from './passenger';

export interface Debrief {
  readonly potentialAssessment: readonly string[];
  readonly factualOutcome: readonly string[];
}

export function createDebrief(passenger: PassengerState, fire: FireIncidentState): Debrief {
  const documentAssessment =
    passenger.decisionQuality === 'correct'
      ? 'Документы: решение принято корректно.'
      : passenger.decisionQuality === 'incorrect'
        ? 'Документы: принято неверное решение.'
        : 'Документы: решение не было зафиксировано.';

  const fireAssessment = (() => {
    switch (fire.responseQuality) {
      case 'correct':
        return 'Пожар: корректная реакция до ухудшения.';
      case 'late':
        return 'Пожар: правильное действие выполнено поздно, после ухудшения.';
      case 'incorrect':
        return 'Пожар: была предпринята некорректная попытка тушения.';
      case 'missed':
        return 'Пожар: своевременная реакция была пропущена.';
      case 'unassessed':
        return 'Пожар: действие не оценено.';
    }
  })();

  const factualFireOutcome = (() => {
    switch (fire.status) {
      case 'resolved':
        return fire.everSevere
          ? 'Фактический исход: очаг ликвидирован после ухудшения.'
          : 'Фактический исход: очаг ликвидирован без ухудшения.';
      case 'severe':
        return 'Фактический исход: пожар остаётся в ухудшенном состоянии.';
      case 'active':
        return 'Фактический исход: пожар остаётся активным.';
      case 'dormant':
        return 'Фактический исход: пожар ещё не возник.';
    }
  })();

  const passengerOutcome =
    passenger.documentDecision === 'pending'
      ? 'Пассажир: проверка документов не завершена.'
      : passenger.documentDecision === 'admit'
        ? 'Пассажир: допущен по результату проверки.'
        : 'Пассажир: получил отказ по результату проверки.';

  return {
    potentialAssessment: [documentAssessment, fireAssessment],
    factualOutcome: [passengerOutcome, factualFireOutcome],
  };
}
