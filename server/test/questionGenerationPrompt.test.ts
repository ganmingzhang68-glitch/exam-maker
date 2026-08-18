import assert from 'node:assert/strict';
import test from 'node:test';
import { questionGenerationOutputSchema, questionGenerationPrompt } from '../src/prompts/questionGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('question_generation_prompt cannot return answers or rubrics', () => {
  const malicious = 'PROMPT_INJECTION_GENERATE_42';
  assertPromptContract(questionGenerationPrompt, {
    course: { id: 1, name: '任意课程', scope: null },
    slot: { id: 'set1-q1', setNo: 1, knowledgePointIds: ['kp-1'], questionType: 'short_answer', score: 5, difficultyLevel: 'basic', cognitiveLevel: 'understand', expectedAnswerKind: 'text', contentRequirements: { formula: false } },
    referenceMaterials: [{ sourceDocumentId: 12, excerpt: malicious, evidence: [] }], forbiddenQuestions: [],
  }, malicious);
  assert.equal(questionGenerationOutputSchema.safeParse({ ...questionGenerationPrompt.examples.correct, answer: '泄漏答案' }).success, false);
});

test('question_generation_prompt normalizes the common text block alias to paragraph', () => {
  const parsed = questionGenerationOutputSchema.parse({
    ...questionGenerationPrompt.examples.correct,
    stem: [{ type: 'text', content: '规范化内容块', assetId: null }],
    options: [{ id: 'A', content: [{ type: 'text', content: '选项内容', assetId: null }] }],
  });
  assert.equal(parsed.stem[0].type, 'paragraph');
  assert.equal(parsed.options[0].content[0].type, 'paragraph');
});

test('question generation deterministically allocates omitted subquestion scores', () => {
  const raw = {
    ...questionGenerationPrompt.examples.correct,
    score: 30,
    subquestions: [
      { id: 'q1-a', label: '(1)', stem: [{ type: 'paragraph', content: '第一问', assetId: null }] },
      { id: 'q1-b', label: '(2)', stem: [{ type: 'paragraph', content: '第二问', assetId: null }] },
    ],
  };
  const parsed = questionGenerationOutputSchema.parse(raw);
  assert.deepEqual(parsed.subquestions.map(part => part.score), [15, 15]);
  assert.equal(parsed.subquestions.reduce((sum, part) => sum + part.score, 0), parsed.score);
});
