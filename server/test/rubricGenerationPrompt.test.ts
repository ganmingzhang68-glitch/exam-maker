import assert from 'node:assert/strict';
import test from 'node:test';
import { rubricGenerationOutputSchema, rubricGenerationPrompt } from '../src/prompts/rubricGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('rubric_generation_prompt enforces the question score', () => {
  const malicious = 'PROMPT_INJECTION_RUBRIC_42';
  assertPromptContract(rubricGenerationPrompt, {
    question: { id: 'gq-1', questionType: 'essay', stem: [{ type: 'paragraph', content: malicious }], subquestions: [], score: 10 },
    answer: { answer: { kind: 'subjective' }, explanation: [], keySteps: [], acceptableAlternatives: [] },
  }, malicious);
  const invalid = { ...rubricGenerationPrompt.examples.correct, items: [{ ...rubricGenerationPrompt.examples.correct.items[0], points: 1 }] };
  assert.equal(rubricGenerationOutputSchema.safeParse(invalid).success, false);
});

test('rubric prompt receives every frozen subquestion and its score', () => {
  const rendered = rubricGenerationPrompt.splitInput(rubricGenerationPrompt.inputSchema.parse({
    question: {
      id: 'gq-2', questionType: 'proof', stem: [{ type: 'paragraph', content: '证明：' }], score: 30,
      subquestions: [
        { id: 'gq-2-1', label: '(1)', stem: [{ type: 'paragraph', content: '证明结论一' }], score: 15 },
        { id: 'gq-2-2', label: '(2)', stem: [{ type: 'paragraph', content: '证明结论二' }], score: 15 },
      ],
    },
    answer: { answer: { kind: 'subjective', keyPoints: ['步骤'] }, explanation: [], keySteps: [], acceptableAlternatives: [] },
  }));
  const frozen = rendered.untrustedData.frozenQuestion as { subquestions: unknown[] };
  assert.equal(frozen.subquestions.length, 2);
});
