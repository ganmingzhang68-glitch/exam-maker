import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb, rawDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { runStructuredPrompt } from '../src/services/promptRunner.js';
import { documentStructurePrompt } from '../src/prompts/documentStructurePrompt.js';

test('runner persists every failed and repaired attempt without source input', async () => {
  await initDb({ filePath: null });
  runMigrations();
  let calls = 0;
  const result = await runStructuredPrompt(documentStructurePrompt, {
    document: { id: 41, filename: 'fixture.txt', mimeType: 'text/plain', pages: [{ pageNumber: 1, text: '敏感原文标记', blockIds: [] }] },
    course: null,
  }, {
    maxRetries: 1,
    transport: async () => {
      calls += 1;
      return calls === 1
        ? { text: '{"bad":true}', inputTokens: 10, outputTokens: 2, totalTokens: 12 }
        : { text: `\`\`\`json\n${JSON.stringify(documentStructurePrompt.examples.exceptional)}\n\`\`\``, inputTokens: 11, outputTokens: 8, totalTokens: 19 };
    },
  });
  assert.equal(result.attempts, 2);
  const rows = rawDb.exec('SELECT status, retry_count, input_hash, output_raw, output_parsed FROM ai_runs ORDER BY id')[0].values;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row[0], row[1]]), [['failed', 0], ['succeeded', 1]]);
  assert.equal(String(rows[0][2]).length, 64);
  assert.equal(JSON.stringify(rows).includes('敏感原文标记'), false);
  assert.equal(rawDb.exec("SELECT COUNT(*) FROM prompt_versions WHERE prompt_id='document_structure_prompt' AND version='1.0.0'")[0].values[0][0], 1);
});
