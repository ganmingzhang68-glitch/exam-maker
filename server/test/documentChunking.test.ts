import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentChunks, estimateTokens, mergeStageResults, selectChunksForStage, tokenBudgetForStage } from '../src/services/documentChunking.js';

const pages = [
  { pageNumber: 1, text: '# 选择题\n1. 令 $x=1$，求值。\nA. 1\nB. 2\n\n2. 阅读代码：\n```js\nconst x = 1;\nconsole.log(x);\n```\n问输出。' },
  { pageNumber: 2, text: '3. 表格题\n|a|b|\n|-|-|\n|1|2|\n\n4（1）先证明结论。\n（2）再计算。' },
];

test('estimates bilingual tokens and builds stable semantic chunks', () => {
  assert.ok(estimateTokens('中文 abc') >= 2);
  const first = buildDocumentChunks(7, pages, { targetTokens: 25, overlapBlocks: 0 });
  const second = buildDocumentChunks(7, pages, { targetTokens: 25, overlapBlocks: 0 });
  assert.deepEqual(first.map((chunk) => chunk.id), second.map((chunk) => chunk.id));
  assert.ok(first.length > 1);
  assert.ok(first.every((chunk) => chunk.sourceDocumentId === 7 && chunk.pageStart <= chunk.pageEnd));
  const codeChunk = first.find((chunk) => chunk.content.includes('```js'));
  assert.ok(codeChunk?.content.includes('console.log(x);\n```'), 'code fence must remain intact');
});

test('stage selection accounts for prompt/output/safety budget and batches in order', () => {
  const chunks = buildDocumentChunks(7, pages, { targetTokens: 18, overlapBlocks: 0 });
  const budget = tokenBudgetForStage('question_parsing', 'system prompt', 3500);
  assert.equal(budget.availableInputTokens, 100 - estimateTokens('system prompt'));
  const batches = selectChunksForStage(chunks, 'question_parsing', 'system prompt', 3500);
  assert.deepEqual(batches.flat().map((chunk) => chunk.order), chunks.map((chunk) => chunk.order));
});

test('deterministic merge removes overlap duplicates without changing first result', () => {
  const merged = mergeStageResults([[{ id: 'q1', value: 1 }], [{ id: 'q1', value: 2 }, { id: 'q2', value: 3 }]], (item) => item.id);
  assert.deepEqual(merged, [{ id: 'q1', value: 1 }, { id: 'q2', value: 3 }]);
});
