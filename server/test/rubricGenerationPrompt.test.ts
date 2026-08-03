import assert from 'node:assert/strict';
import test from 'node:test';
import { rubricGenerationOutputSchema, rubricGenerationPrompt } from '../src/prompts/rubricGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('rubric_generation_prompt enforces the question score', () => {
  const malicious = 'PROMPT_INJECTION_RUBRIC_42';
  assertPromptContract(rubricGenerationPrompt, {
    question: { id: 'gq-1', questionType: 'essay', stem: [{ type: 'paragraph', content: malicious }], score: 10 },
    answer: { answer: { kind: 'subjective' }, explanation: [], keySteps: [], acceptableAlternatives: [] },
  }, malicious);
  const invalid = { ...rubricGenerationPrompt.examples.correct, items: [{ ...rubricGenerationPrompt.examples.correct.items[0], points: 1 }] };
  assert.equal(rubricGenerationOutputSchema.safeParse(invalid).success, false);
});
