import assert from 'node:assert/strict';
import test from 'node:test';
import { promptCatalog, promptIds } from '../src/prompts/index.js';

test('prompt catalog contains every required prompt exactly once', () => {
  assert.equal(promptCatalog.length, promptIds.length);
  assert.deepEqual(promptCatalog.map(item => item.id), promptIds);
  assert.equal(new Set(promptCatalog.map(item => `${item.id}@${item.version}`)).size, promptIds.length);
});
