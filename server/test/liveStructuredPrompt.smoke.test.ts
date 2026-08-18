import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { runStructuredPrompt } from '../src/services/promptRunner.js';
import { documentStructurePrompt } from '../src/prompts/documentStructurePrompt.js';

test('optional live structured prompt smoke test', { skip: process.env.RUN_LIVE_AI_TESTS !== '1' }, async () => {
  assert.ok(process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY, 'RUN_LIVE_AI_TESTS=1 requires an AI key in the environment');
  await initDb({ filePath: null }); runMigrations();
  const result = await runStructuredPrompt(documentStructurePrompt, { document: { id: 1, filename: 'live-smoke.txt', mimeType: 'text/plain', pages: [{ pageNumber: 1, text: '1. 测试题（2分）', blockIds: [] }] }, course: { id: 1, name: '测试课程' } }, { maxRetries: 1, maxTokens: 1200 });
  assert.ok(['ok', 'uncertain'].includes(result.output.status));
});
