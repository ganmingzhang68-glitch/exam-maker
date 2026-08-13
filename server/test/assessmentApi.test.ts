import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import examRoutes from '../src/routes/exam.js';

test('exam quality API is owner-scoped and reports insufficient samples without invented values', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'owner', email: 'owner@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other@test.local', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.questions).values({ id: 1, createdBy: 1, type: 'single_choice', stem: '1+1=?',
    options: JSON.stringify(['A. 1', 'B. 2']), answerKey: JSON.stringify({ selected: 'B' }), defaultScore: 10, status: 'reviewed' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, title: '测试卷', course: '数学', totalScore: 10 }).run();
  db.insert(schema.paperQuestions).values({ id: 1, paperId: 1, questionId: 1, orderNo: 1, score: 10,
    questionSnapshot: JSON.stringify({ type: 'single_choice', stem: '1+1=?' }) }).run();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: '测试考试' }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/exams', examRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  const call = async (userId: number, path = '/api/exams/1/quality', options?: { method: string; body: unknown }) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: options?.method,
      headers: { Authorization: `Bearer ${generateToken(userId, 'teacher')}`, ...(options ? { 'Content-Type': 'application/json' } : {}) },
      body: options ? JSON.stringify(options.body) : undefined });
    return { status: response.status, body: await response.json() as { data?: { sampleStatus: string; summary: { cronbachAlpha: number | null } } } };
  };
  try {
    const owner = await call(1);
    assert.equal(owner.status, 200);
    assert.equal(owner.body.data?.sampleStatus, 'insufficient_sample');
    assert.equal(owner.body.data?.summary.cronbachAlpha, null);
    assert.equal((await call(2)).status, 403);
    const review = await call(1, '/api/exams/1/quality/questions/1/review', { method: 'POST', body: { action: 'needs_revision' } });
    assert.equal(review.status, 200);
    assert.equal(db.select().from(schema.questionQualityReports).all()[0].reviewStatus, 'needs_revision');
    assert.equal(db.select().from(schema.questions).all()[0].lifecycleStatus, 'needs_review');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
