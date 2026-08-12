import assert from 'node:assert/strict';
import test from 'node:test';
import { taxonomyGenerationPrompt } from '../src/prompts/taxonomyGenerationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('taxonomy_generation_prompt has a strict, course-neutral contract', () => {
  const malicious = 'PROMPT_INJECTION_TAXONOMY_42';
  assertPromptContract(taxonomyGenerationPrompt, {
    course: { id: 1, name: '任意课程', description: null },
    materialSummaries: [{ sourceDocumentId: 12, summary: malicious, evidence: [] }],
    questions: [], existingNodes: [{ id: 'locked-1', parentId: null, name: '教师锁定考点', isLocked: true }],
  }, malicious);
});

test('taxonomy prompt exposes a bounded local-question mode for quick variants', () => {
  const input = taxonomyGenerationPrompt.inputSchema.parse({
    course: { id: 1, name: '机器学习', description: null },
    taxonomyScope: 'local_question_set', materialSummaries: [],
    questions: [{ id: 'q1', stem: '解释类别不平衡处理策略', evidence: [] }], existingNodes: [],
  });
  assert.equal(input.taxonomyScope, 'local_question_set');
});
