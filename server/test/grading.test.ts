import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeObjectiveAnswer, isObjectiveType } from '../src/services/grading.js';

test('single choice grading gives full score only for an exact answer', () => {
  assert.deepEqual(gradeObjectiveAnswer('single_choice', 'B', { option: 'B' }, 5), { correct: true, score: 5 });
  assert.deepEqual(gradeObjectiveAnswer('single_choice', 'A', { option: 'B' }, 5), { correct: false, score: 0 });
});

test('multiple choice grading requires an exact option set', () => {
  const key = { options: ['A', 'C'] };
  assert.deepEqual(gradeObjectiveAnswer('multiple_choice', ['C', 'A'], key, 8), { correct: true, score: 8 });
  assert.deepEqual(gradeObjectiveAnswer('multiple_choice', ['A'], key, 8), { correct: false, score: 0 });
  assert.deepEqual(gradeObjectiveAnswer('multiple_choice', ['A', 'B', 'C'], key, 8), { correct: false, score: 0 });
  assert.deepEqual(gradeObjectiveAnswer('multiple_choice', ['A', 'B'], key, 8), { correct: false, score: 0 });
});

test('true/false grading normalizes common boolean representations', () => {
  assert.deepEqual(gradeObjectiveAnswer('true_false', '正确', { answer: true }, 2), { correct: true, score: 2 });
  assert.deepEqual(gradeObjectiveAnswer('true_false', '错误', { answer: true }, 2), { correct: false, score: 0 });
});

test('fill blank grading trims spaces and optionally ignores case', () => {
  assert.deepEqual(gradeObjectiveAnswer('fill_blank', '  OpenAI ', { text: 'OpenAI' }, 4, false), { correct: true, score: 4 });
  assert.deepEqual(gradeObjectiveAnswer('fill_blank', 'openai', { text: 'OpenAI' }, 4, false), { correct: false, score: 0 });
  assert.deepEqual(gradeObjectiveAnswer('fill_blank', 'openai', { text: 'OpenAI' }, 4, true), { correct: true, score: 4 });
});

test('subjective question types are never objectively graded', () => {
  assert.equal(isObjectiveType('short_answer'), false);
  assert.equal(isObjectiveType('calculation'), false);
  assert.equal(isObjectiveType('essay'), false);
});
