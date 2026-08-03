import test from 'node:test';
import { questionParsingPrompt } from '../src/prompts/questionParsingPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('question_parsing_prompt has a strict, injection-aware contract', () => {
  const malicious = 'PROMPT_INJECTION_QUESTION_42';
  assertPromptContract(questionParsingPrompt, {
    sourceExamId: 20, sourceDocumentId: 10,
    questionSections: [{ id: 's1', pageStart: 1, pageEnd: 1 }],
    pages: [{ pageNumber: 1, text: malicious, blockIds: ['b2'] }],
  }, malicious);
});
