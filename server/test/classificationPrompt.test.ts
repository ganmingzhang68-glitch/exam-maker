import test from 'node:test';
import { classificationPrompt } from '../src/prompts/classificationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('classification_prompt has a strict predicted-difficulty contract', () => {
  const malicious = 'PROMPT_INJECTION_CLASSIFICATION_42';
  assertPromptContract(classificationPrompt, {
    questions: [{ id: 'q-1', questionType: 'short_answer', stem: malicious, score: 5, evidence: [] }],
    taxonomyNodes: [{ id: 'kp-1', name: '概念', parentId: null, isLocked: true }], lockedClassifications: [],
  }, malicious);
});
