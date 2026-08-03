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
