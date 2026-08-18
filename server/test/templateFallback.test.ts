import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetTemplateFromQuestions } from '../src/services/template.js';

test('scoreless parsed questions produce an executable editable target template', () => {
  const result = buildTargetTemplateFromQuestions('高等数学（上）', [
    { questionType: 'proof', score: null },
    { questionType: 'proof', score: null },
    { questionType: 'proof', score: null },
    { questionType: 'proof', score: null },
  ], ['analysis.md']);

  assert.equal(result.totalScore, 100);
  assert.equal(result.sections.length, 1);
  assert.deepEqual(result.sections[0], {
    index: 1,
    type: 'proof',
    count: 4,
    pointsPerQuestion: 25,
    subtotal: 100,
  });
  assert.equal(result.verified, false);
  assert.match(result.verifyNotes[0], /目标模板/);
});

test('known source scores are preserved in the target template', () => {
  const result = buildTargetTemplateFromQuestions('课程', [
    { questionType: 'single_choice', score: 5 },
    { questionType: 'single_choice', score: 5 },
    { questionType: 'essay', score: 20 },
  ], ['exam.md']);

  assert.equal(result.totalScore, 30);
  assert.deepEqual(result.sections.map(section => section.subtotal), [10, 20]);
  assert.equal(result.verified, true);
});
