import { describe, expect, it } from 'vitest';
import type { AcceptanceJournalState, ExtinguisherState } from './item-store';
import { type JournalEquipmentState, journalSubmissionFacts } from './journal-truth';

function journal(overrides: Partial<AcceptanceJournalState> = {}): AcceptanceJournalState {
  return {
    id: 'acceptance-journal',
    kind: 'acceptance-journal',
    location: 'anchor',
    homeAnchorId: 'desk',
    homeCellId: 'platform',
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
    submitted: true,
    ...overrides,
  };
}

function extinguisher(overrides: Partial<ExtinguisherState> = {}): ExtinguisherState {
  return {
    id: 'extinguisher',
    kind: 'extinguisher',
    location: 'mounted',
    mountAnchorId: 'mount',
    mountCellId: 'cabin',
    pin: 'present',
    seal: 'intact',
    pressure: 'normal',
    bodyDamage: 'none',
    used: false,
    ...overrides,
  };
}

function equipment(extinguisherState = extinguisher()): JournalEquipmentState {
  return {
    extinguisher: extinguisherState,
    emergencyBrake: { seal: 'intact', activated: false },
  };
}

describe('journalSubmissionFacts', () => {
  it('treats healthy equipment and an all-ok journal as neither false nor missed', () => {
    expect(journalSubmissionFacts(journal(), equipment())).toEqual({
      sanitation: 'clean',
      reportedProblem: false,
      realProblem: false,
      falseReport: false,
      missedProblem: false,
    });
  });

  it.each([
    { pressure: 'low' as const },
    { pressure: 'high' as const },
    { seal: 'broken' as const },
    { pin: 'removed' as const },
    { bodyDamage: 'scratch' as const },
    { bodyDamage: 'dent' as const },
    { used: true },
  ])('counts a reported extinguisher fault as real (%o)', (fault) => {
    expect(
      journalSubmissionFacts(journal({ extinguisher: 'problem' }), equipment(extinguisher(fault))),
    ).toMatchObject({
      reportedProblem: true,
      realProblem: true,
      falseReport: false,
      missedProblem: false,
    });
  });

  it('counts an unreported extinguisher fault as missed', () => {
    expect(
      journalSubmissionFacts(journal(), equipment(extinguisher({ seal: 'broken' }))),
    ).toMatchObject({
      reportedProblem: false,
      realProblem: false,
      falseReport: false,
      missedProblem: true,
    });
  });

  it('counts a reported broken or activated brake as real and an ok mark as missed', () => {
    const broken = equipment();
    expect(
      journalSubmissionFacts(journal({ emergencyBrake: 'problem' }), {
        ...broken,
        emergencyBrake: { seal: 'broken', activated: false },
      }),
    ).toMatchObject({ realProblem: true, falseReport: false, missedProblem: false });

    expect(
      journalSubmissionFacts(journal(), {
        ...broken,
        emergencyBrake: { seal: 'broken', activated: true },
      }),
    ).toMatchObject({ realProblem: false, falseReport: false, missedProblem: true });
  });

  it('never treats climate or communication as a real fault', () => {
    expect(journalSubmissionFacts(journal({ climate: 'problem' }), equipment())).toMatchObject({
      reportedProblem: true,
      realProblem: false,
      falseReport: true,
      missedProblem: false,
    });
    expect(
      journalSubmissionFacts(journal({ communication: 'problem' }), equipment()),
    ).toMatchObject({
      reportedProblem: true,
      realProblem: false,
      falseReport: true,
    });
  });

  it('stacks a false mark with a missed real fault', () => {
    expect(
      journalSubmissionFacts(
        journal({ communication: 'problem', extinguisher: 'ok' }),
        equipment(extinguisher({ pin: 'removed' })),
      ),
    ).toMatchObject({
      reportedProblem: true,
      realProblem: false,
      falseReport: true,
      missedProblem: true,
    });
  });

  it('ignores sanitation when deciding critical journal truth', () => {
    expect(journalSubmissionFacts(journal({ sanitation: 'issue' }), equipment())).toMatchObject({
      sanitation: 'issue',
      reportedProblem: false,
      realProblem: false,
      falseReport: false,
      missedProblem: false,
    });
  });
});
