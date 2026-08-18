import assert from 'node:assert/strict';
import test from 'node:test';
import { answerGenerationOutputSchema, answerGenerationPrompt } from '../src/prompts/answerGenerationPrompt.js';
import { parsePromptOutput } from '../src/prompts/core.js';
import { assertPromptContract } from './promptTestSupport.js';

test('answer_generation_prompt cannot modify the frozen question or emit a rubric', () => {
  const malicious = 'PROMPT_INJECTION_ANSWER_GENERATION_42';
  assertPromptContract(answerGenerationPrompt, {
    question: { id: 'gq-1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: malicious }], options: [], subquestions: [], score: 5 }, expectedAnswerKind: 'text', referenceMaterials: [],
  }, malicious);
  assert.equal(answerGenerationOutputSchema.safeParse({ ...answerGenerationPrompt.examples.correct, rubric: [] }).success, false);
});

test('answer generation normalizes omitted nullable evidence locations', () => {
  const parsed = parsePromptOutput(answerGenerationPrompt, JSON.stringify({
    ...answerGenerationPrompt.examples.correct,
    evidence: [{ sourceDocumentId: 12, quote: '材料证据' }],
  }));
  assert.equal(parsed.evidence[0].pageNumber, null);
  assert.equal(parsed.evidence[0].blockId, null);
});

test('answer prompt requires solving a self-contained question without a copied source answer', () => {
  assert.match(answerGenerationPrompt.task, /通用学科知识推导时必须独立求解/);
  assert.match(answerGenerationPrompt.task, /evidence 可以为空/);
});
