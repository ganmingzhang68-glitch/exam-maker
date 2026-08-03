import test from 'node:test';
import { templateExtractionPrompt } from '../src/prompts/templateExtractionPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('template_extraction_prompt keeps assessment and rendering data separate', () => {
  const malicious = 'PROMPT_INJECTION_TEMPLATE_42';
  assertPromptContract(templateExtractionPrompt, {
    course: { id: 1, name: '任意课程' }, sourceExams: [{ id: 20, title: '历史试卷', durationMinutes: null, instructions: [] }],
    questions: [{ sourceExamId: 20, questionNo: '1', questionType: 'short_answer', score: null, sectionTitle: malicious, evidence: [] }], renderingEvidence: [],
  }, malicious);
});
