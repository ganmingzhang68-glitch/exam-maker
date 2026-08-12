import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePromptOutput } from '../src/prompts/core.js';
import { questionParsingOutputSchema, questionParsingPrompt } from '../src/prompts/questionParsingPrompt.js';
import { assertPromptContract } from './promptTestSupport.js';

test('question_parsing_prompt has a strict, injection-aware contract', () => {
  const malicious = 'PROMPT_INJECTION_QUESTION_42';
  assertPromptContract(questionParsingPrompt, {
    sourceExamId: 20, sourceDocumentId: 10,
    questionSections: [{ id: 's1', pageStart: 1, pageEnd: 1 }],
    pages: [{ pageNumber: 1, text: malicious, blockIds: ['b2'] }],
  }, malicious);
});

test('question parsing normalizes empty evidence block ids to null', () => {
  const example = structuredClone(questionParsingPrompt.examples.correct);
  example.questions[0].evidence[0].blockId = '';
  const parsed = questionParsingOutputSchema.parse(example);
  assert.equal(parsed.questions[0].evidence[0].blockId, null);
});

test('question parsing safely normalizes missing subquestion confidence and absent scores', () => {
  const output = structuredClone(questionParsingPrompt.examples.correct) as Record<string, unknown>;
  const questions = output.questions as Array<Record<string, unknown>>;
  questions[0].originalScore = 0;
  questions[0].subquestions = [{ label: '1', rawStem: '证明第一问', originalScore: 0 }];

  const parsed = parsePromptOutput(questionParsingPrompt, JSON.stringify(output));
  assert.equal(parsed.questions[0].originalScore, null);
  assert.equal(parsed.questions[0].subquestions[0].originalScore, null);
  assert.equal(parsed.questions[0].subquestions[0].confidence, 0);
});
