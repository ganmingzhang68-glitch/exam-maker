import test from 'node:test';
import { answerAlignmentPrompt } from '../src/prompts/answerAlignmentPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('answer_alignment_prompt has a strict, injection-aware contract', () => {
  const malicious = 'PROMPT_INJECTION_ANSWER_42';
  assertPromptContract(answerAlignmentPrompt, {
    questions: [{ temporaryId: 'q-1', originalQuestionNo: '1', rawStem: malicious, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'q1', quote: '1.' }] }],
    answerCandidates: [{ candidateId: 'a-1', originalQuestionNo: '1', rawAnswer: 'A', rawAnalysis: null, evidence: [{ sourceDocumentId: 11, pageNumber: 3, blockId: 'a1', quote: '1. A' }] }],
  }, malicious);
});
