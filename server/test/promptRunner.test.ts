import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrompt } from '../src/prompts/core.js';
import { documentStructurePrompt } from '../src/prompts/documentStructurePrompt.js';

test('structured prompt runner keeps uploaded text out of the system message', () => {
  const marker = 'RUNNER_INJECTION_MARKER';
  const rendered = renderPrompt(documentStructurePrompt, {
    document: { id: 1, filename: 'x.txt', mimeType: 'text/plain', pages: [{ pageNumber: 1, text: marker, blockIds: [] }] }, course: null,
  });
  assert.equal(rendered.systemPrompt.includes(marker), false);
  assert.equal(rendered.userPrompt.includes(marker), true);
});
