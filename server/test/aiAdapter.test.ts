import assert from 'node:assert/strict';
import test from 'node:test';
import { sendMessage } from '../src/services/ai.js';

test('DeepSeek structured calls disable V4 thinking mode and request JSON output', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
  };
  let requestBody: Record<string, unknown> | null = null;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_BASE_URL = 'https://example.invalid';
  process.env.AI_MODEL = 'deepseek-v4-pro';
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"status":"ok"}', reasoning_content: null } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    assert.equal(await sendMessage('system', [{ role: 'user', content: 'input' }]), '{"status":"ok"}');
    assert.deepEqual(requestBody?.thinking, { type: 'disabled' });
    assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('AI adapter rejects reasoning-only responses instead of reporting fake JSON', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_PROVIDER = 'deepseek';
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'unfinished reasoning' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(
      sendMessage('system', [{ role: 'user', content: 'input' }]),
      /empty final content.*reasoning_only=true/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = originalProvider;
  }
});
