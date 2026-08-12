import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePromptOutput, renderPrompt } from '../src/prompts/core.js';
import { classificationPrompt } from '../src/prompts/classificationPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('classification_prompt has a strict predicted-difficulty contract', () => {
  const malicious = 'PROMPT_INJECTION_CLASSIFICATION_42';
  assertPromptContract(classificationPrompt, {
    questions: [{ id: 'q-1', questionType: 'short_answer', stem: malicious, score: 5, evidence: [] }],
    taxonomyNodes: [{ id: 'kp-1', name: '概念', parentId: null, isLocked: true }], lockedClassifications: [],
  }, malicious);
});

test('classification_prompt declares exact difficulty values and normalizes intermediate', () => {
  const rendered = renderPrompt(classificationPrompt, {
    questions: [{ id: 'q-1', questionType: 'proof', stem: '证明命题', score: null, evidence: [] }],
    taxonomyNodes: [{ id: 'kp-1', name: '极限', parentId: null, isLocked: false }],
    lockedClassifications: [],
  });
  assert.match(rendered.systemPrompt, /difficultyLevel 只能是 basic、medium、hard/);

  const raw = JSON.stringify(classificationPrompt.examples.correct)
    .replace('"difficultyLevel":"basic"', '"difficultyLevel":"intermediate"');
  const parsed = parsePromptOutput(classificationPrompt, raw);
  assert.equal(parsed.classifications[0].difficulty.difficultyLevel, 'medium');
});

test('structured output parse errors include the native JSON location for repair', () => {
  assert.throws(
    () => parsePromptOutput(classificationPrompt, '{"status":"ok","classifications":['),
    /必须返回单个 JSON 对象/,
  );
  assert.throws(
    () => parsePromptOutput(classificationPrompt, '{"status":"ok","classifications":[}],"issues":[]}'),
    /返回无效 JSON: /,
  );
});
