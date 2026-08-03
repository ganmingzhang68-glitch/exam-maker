import assert from 'node:assert/strict';
import test from 'node:test';
import { answerGenerationOutputSchema, answerGenerationPrompt } from '../src/prompts/answerGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('answer_generation_prompt cannot modify the frozen question or emit a rubric', () => {
  const malicious = 'PROMPT_INJECTION_ANSWER_GENERATION_42';
  assertPromptContract(answerGenerationPrompt, {
    question: { id: 'gq-1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: malicious }], options: [], subquestions: [], score: 5 }, expectedAnswerKind: 'text', referenceMaterials: [],
  }, malicious);
  assert.equal(answerGenerationOutputSchema.safeParse({ ...answerGenerationPrompt.examples.correct, rubric: [] }).success, false);
});
