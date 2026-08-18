import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestionSchema, updateQuestionSchema } from '@exam-maker/shared';

test('question validation requires choice options and a non-empty stem', () => {
  const invalidChoice = createQuestionSchema.safeParse({ type: 'single_choice', stem: '题目', options: ['A'] });
  assert.equal(invalidChoice.success, false);
  assert.equal(updateQuestionSchema.safeParse({ stem: '   ' }).success, false);

  const valid = createQuestionSchema.parse({
    type: 'single_choice',
    stem: '请选择正确答案',
    options: ['A', 'B'],
    answerKey: { option: 'A' },
    status: 'reviewed',
  });
  assert.equal(valid.status, 'reviewed');
  assert.equal(valid.defaultScore, 0);
});
