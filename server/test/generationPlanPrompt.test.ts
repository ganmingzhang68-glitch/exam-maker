import test from 'node:test';
import { generationPlanPrompt } from '../src/prompts/generationPlanPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('generation_plan_prompt returns conflicts instead of changing constraints', () => {
  const malicious = 'PROMPT_INJECTION_PLAN_42';
  assertPromptContract(generationPlanPrompt, {
    numberOfSets: 1, totalScorePerSet: 10,
    assessmentTemplate: { sections: [{ id: 's1', questionType: malicious, questionCount: 1, subtotal: 10 }], totalScore: 10 },
    targetBlueprint: { id: 1, cells: [{ knowledgePointId: 'kp-1', questionType: 'short_answer', cognitiveLevel: 'apply', difficultyLevel: 'medium', questionCount: 1, score: 10 }] },
    tolerances: { difficulty: 0.05, knowledgeCoverage: 0.05 }, materialCapabilities: { formula: true, image: false, code: false, table: false, material: false },
  }, malicious);
});
