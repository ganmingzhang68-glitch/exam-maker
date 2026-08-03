import test from 'node:test';
import { blueprintGenerationPrompt } from '../src/prompts/blueprintGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('blueprint_generation_prompt cannot create a target blueprint', () => {
  const malicious = 'PROMPT_INJECTION_BLUEPRINT_42';
  assertPromptContract(blueprintGenerationPrompt, {
    kind: 'historical', courseId: 1, projectId: 1, totalScore: 5,
    questions: [{ id: 'q-1', knowledgePointIds: ['kp-1'], questionType: 'essay', cognitiveLevel: 'analyze', difficultyLevel: 'medium', score: 5, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'q1', quote: malicious }] }],
  }, malicious);
});
