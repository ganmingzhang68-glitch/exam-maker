import test from 'node:test';
import { documentStructurePrompt } from '../src/prompts/documentStructurePrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('document_structure_prompt has a strict, injection-aware contract', () => {
  const malicious = 'PROMPT_INJECTION_DOCUMENT_42';
  assertPromptContract(documentStructurePrompt, {
    document: { id: 10, filename: 'exam.pdf', mimeType: 'application/pdf', pages: [{ pageNumber: 1, text: malicious, blockIds: ['b1'] }] },
    course: { id: 1, name: '任意课程' },
  }, malicious);
});
