import test from 'node:test';
import assert from 'node:assert/strict';
import { isDifficultyPlanCompatible, latexSourceNeedsRerender } from '../src/services/workflow.js';

test('resume rejects a difficulty plan that multiplied assessment questions', () => {
  const template = { totalScore: 100, sections: [{ count: 4 }] };
  assert.equal(isDifficultyPlanCompatible(template, {
    slots: Array.from({ length: 12 }, () => ({ score: 100 / 12 })),
  }), false);
  assert.equal(isDifficultyPlanCompatible(template, {
    slots: [{ score: 30 }, { score: 30 }, { score: 30 }, { score: 10 }],
  }), true);
  assert.equal(isDifficultyPlanCompatible(template, {
    summary: { passed: false },
    slots: [{ score: 25 }, { score: 25 }, { score: 25 }, { score: 25 }],
  }), false);
});

test('resume detects legacy rendering that corrupted inline math or left Markdown tables', () => {
  assert.equal(latexSourceNeedsRerender('若 \\textbackslash{}(l=0\\textbackslash{})'), true);
  assert.equal(latexSourceNeedsRerender('| 性质 | 值 |\n|---|---|'), true);
  assert.equal(latexSourceNeedsRerender('若 \\(l=0\\)，则成立。'), false);
});
