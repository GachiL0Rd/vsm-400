import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyChoice,
  createRun,
  currentStep,
  generateScenario,
  LESSON_IDS,
} from '../src/domain/scenarios.ts';

test('generator creates local variants and valid decision graphs', () => {
  for (const id of LESSON_IDS) {
    const scenario = generateScenario(id, () => 0);
    const steps = new Map(scenario.steps.map((step) => [step.id, step]));
    assert.ok(steps.has(scenario.firstStepId));
    for (const step of scenario.steps) {
      assert.equal(new Set(step.choices.map((choice) => choice.id)).size, step.choices.length);
      if (step.timeoutChoiceId) {
        assert.ok(step.timeLimitSeconds && step.timeLimitSeconds > 0);
        assert.ok(step.choices.some((choice) => choice.id === step.timeoutChoiceId && choice.isTimeout));
      }
      for (const choice of step.choices) {
        if (choice.nextStepId) assert.ok(steps.has(choice.nextStepId));
      }
    }
  }

  const first = generateScenario('aisle', () => 0);
  const last = generateScenario('aisle', () => 0.99);
  assert.notEqual(first.setting, last.setting);
  assert.notEqual(first.steps[0]?.dialogue, last.steps[0]?.dialogue);
});

test('a meaningful choice changes the branch and both outcome scales', () => {
  let run = createRun(generateScenario('aisle', () => 0));
  run = applyChoice(run, 'identify');
  assert.equal(currentStep(run)?.id, 'resistance');
  assert.equal(run.safety, 72);
  assert.equal(run.loyalty, 68);
  run = applyChoice(run, 'explain');
  assert.equal(run.stepId, null);
  assert.equal(run.safety, 90);
  assert.equal(run.loyalty, 76);
  assert.equal(run.answers.length, 2);
});

test('ignored risk leads to a recovery branch; timer expiry has a distinct result', () => {
  const scenario = generateScenario('aisle', () => 0);
  const ignored = applyChoice(createRun(scenario), 'ignore');
  assert.equal(currentStep(ignored)?.id, 'obstruction');
  const recovered = applyChoice(ignored, 'recover');
  const expired = applyChoice(ignored, 'timeout');
  assert.ok(recovered.safety > expired.safety);
  assert.ok(recovered.loyalty > expired.loyalty);
  assert.equal(expired.answers[1]?.isTimeout, true);
  assert.equal(expired.stepId, null);
});

test('all three lessons can be completed in two decisions', () => {
  for (const id of LESSON_IDS) {
    let run = createRun(generateScenario(id, () => 0));
    for (let decision = 0; decision < 2; decision += 1) {
      const step = currentStep(run);
      assert.ok(step);
      const firstVisible = step.choices.find((choice) => !choice.isTimeout);
      assert.ok(firstVisible);
      run = applyChoice(run, firstVisible.id);
    }
    assert.equal(run.stepId, null);
    assert.equal(run.answers.length, 2);
  }
});
