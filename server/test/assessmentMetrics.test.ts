import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAssessmentMetrics } from '../src/services/assessmentMetrics.js';

const items = [
  { paperQuestionId: 1, questionId: 11, orderNo: 1, stem: 'Q1', type: 'single_choice' as const, maxScore: 1,
    options: ['A', 'B', 'C', 'D'].map(id => ({ id, text: id })), correctOptionIds: ['A'] },
  { paperQuestionId: 2, questionId: 12, orderNo: 2, stem: 'Q2', type: 'true_false' as const, maxScore: 1 },
];

function input(count = 10) {
  const responses = Array.from({ length: count }, (_, index) => {
    const q1 = index < Math.ceil(count * 0.7) ? 1 : 0;
    const q2 = index < Math.ceil(count * 0.4) ? 1 : 0;
    return { respondentId: index + 1, totalScore: q1 + q2,
      itemScores: { 1: q1, 2: q2 }, itemCorrect: { 1: Boolean(q1), 2: Boolean(q2) },
      itemSelections: { 1: [q1 ? 'A' : index % 2 ? 'B' : 'C'], 2: [q2 ? 'TRUE' : 'FALSE'] } };
  });
  return { examId: 1, paperTitle: '统计测试卷', totalScore: 2, items, responses };
}

test('assessment metrics calculate deterministic CTT values with difficulty direction documented', () => {
  const result = calculateAssessmentMetrics(input());
  assert.equal(result.sampleStatus, 'ok');
  assert.equal(result.summary.meanScore, 1.1);
  assert.equal(result.summary.medianScore, 1);
  assert.equal(result.summary.passingRate, 0.4);
  assert.equal(result.items[0].correctRate, 0.7);
  assert.equal(result.items[0].empiricalDifficulty, 0.3);
  assert.equal(result.items[0].highGroupCorrectRate, 1);
  assert.equal(result.items[0].lowGroupCorrectRate, 0);
  assert.equal(result.items[0].discriminationIndex, 1);
  assert.ok(result.items[0].pointBiserialCorrelation! > 0);
  assert.ok(result.summary.cronbachAlpha! > 0);
  assert.equal(result.items[0].optionStatistics.find(option => option.optionId === 'D')?.status, 'unused');
  assert.ok(result.items[0].flags.includes('WEAK_DISTRACTOR'));
  assert.equal(result.items[0].blankRate, 0);
});

test('assessment metrics suppress unstable discrimination and reliability for insufficient samples', () => {
  const result = calculateAssessmentMetrics(input(4));
  assert.equal(result.sampleStatus, 'insufficient_sample');
  assert.equal(result.items[0].discriminationIndex, null);
  assert.equal(result.items[0].pointBiserialCorrelation, null);
  assert.equal(result.summary.cronbachAlpha, null);
  assert.deepEqual(result.items[0].flags, ['INSUFFICIENT_SAMPLE']);
});
