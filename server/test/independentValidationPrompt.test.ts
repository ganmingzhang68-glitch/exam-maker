import assert from 'node:assert/strict';
import test from 'node:test';
import { independentValidationOutputSchema, independentValidationPrompt } from '../src/prompts/independentValidationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('independent_validation_prompt cannot pass serious findings', () => {
  const malicious = 'PROMPT_INJECTION_VALIDATION_42';
  assertPromptContract(independentValidationPrompt, {
    scope: 'paper_quality', canonicalObject: { title: malicious }, constraints: {}, deterministicFindings: [], sourceEvidence: [],
  }, malicious);
  const invalid = { ...independentValidationPrompt.examples.correct, passed: true };
  assert.equal(independentValidationOutputSchema.safeParse(invalid).success, false);
});
