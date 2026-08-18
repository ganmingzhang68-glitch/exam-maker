import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestIdMiddleware } from '../src/middleware/requestId.js';
import taskRoutes from '../src/routes/task.js';
import similarQuestionRoutes from '../src/routes/similarQuestion.js';

type JsonBody = { success: boolean; data?: Record<string, unknown> | Array<Record<string, unknown>>; error?: string; requestId?: string };

async function fixture() {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@local.test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other@local.test', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.similarQuestionJobs).values({
    id: 10, requestedBy: 1, course: '高等数学', sourceText: '1. 求导数。', status: 'pending', taskStatus: 'queued', requestId: 'request-task-10',
    createdAt: '2026-08-13 00:00:00', updatedAt: '2026-08-13T00:00:01.000Z',
  }).run();
  db.insert(schema.similarQuestionJobStages).values({
    jobId: 10, stage: 'question_parsing', attemptNo: 1, status: 'succeeded', retryable: false,
    startedAt: '2026-08-13T00:00:00.000Z', finishedAt: '2026-08-13T00:00:01.000Z',
  }).run();

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(authMiddleware);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/similar-question-jobs', similarQuestionRoutes);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  const call = async (path: string, userId = 1, options?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: options?.method ?? 'GET',
      headers: { Authorization: `Bearer ${generateToken(userId, 'teacher')}`,
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, requestId: response.headers.get('x-request-id'), body: await response.json() as JsonBody };
  };
  return { server, call };
}

test('task center exposes real stages, enforces ownership and supports cancellation', async () => {
  const { server, call } = await fixture();
  try {
    const list = await call('/tasks');
    assert.equal(list.status, 200);
    const row = (list.body.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.completedStages, 1);
    assert.equal(row.totalStages, 6);
    assert.equal(row.requestId, 'request-task-10');
    assert.equal(row.estimatedCost, null);
    assert.equal(row.durationMs, 1000);

    const denied = await call('/tasks/similar_question/10', 2, { headers: { 'X-Request-Id': 'test-request-denied' } });
    assert.equal(denied.status, 404);
    assert.equal(denied.body.requestId, 'test-request-denied');
    assert.equal(denied.requestId, 'test-request-denied');

    const cancelled = await call('/tasks/similar_question/10/cancel', 1, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body.data as Record<string, unknown>).status, 'cancelled');
    assert.ok(db.select().from(schema.similarQuestionJobs).where(eq(schema.similarQuestionJobs.id, 10)).get()?.cancelRequestedAt);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('similar-question creation is idempotent per user and key', async () => {
  const { server, call } = await fixture();
  const body = { course: '线性代数', sourceText: '1. 求矩阵的秩。', variantsPerQuestion: 1, defaultScore: 10, difficultyMode: 'same' };
  try {
    const headers = { 'Idempotency-Key': 'create-linear-algebra-001' };
    const first = await call('/similar-question-jobs', 1, { method: 'POST', body, headers });
    const second = await call('/similar-question-jobs', 1, { method: 'POST', body, headers });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal((first.body.data as Record<string, unknown>).id, (second.body.data as Record<string, unknown>).id);
    assert.equal(db.select().from(schema.similarQuestionJobs).where(and(
      eq(schema.similarQuestionJobs.requestedBy, 1), eq(schema.similarQuestionJobs.idempotencyKey, headers['Idempotency-Key']),
    )).all().length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
