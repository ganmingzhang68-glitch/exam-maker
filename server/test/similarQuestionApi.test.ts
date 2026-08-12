import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import similarQuestionRoutes from '../src/routes/similarQuestion.js';

test('similar-question API enforces ownership and saves validated AI output for teacher review', async () => {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@local.test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other@local.test', passwordHash: 'x', role: 'teacher' },
    { id: 3, username: 'student', email: 'student@local.test', passwordHash: 'x', role: 'student' },
  ]).run();
  const prompt = db.insert(schema.promptVersions).values({
    key: 'question_generation_prompt', promptId: 'question_generation_prompt', version: 'test',
    stage: 'question_generation', pipelineStage: 'question_generation', template: 'test',
    inputSchemaVersion: 'test', outputSchemaVersion: 'test', sha256: 'test', status: 'active',
  }).returning().get();
  const resultItem = {
    generatedQuestionId: 1, sourceQuestionNo: '1', questionType: 'calculation',
    stem: [{ type: 'paragraph', content: '在新情境中求函数的瞬时变化率。', assetId: null }],
    options: [], subquestions: [], score: 10, knowledgePoints: ['导数的定义'], cognitiveLevel: 'apply',
    difficulty: { difficultyLevel: 'medium', difficultyScore: 0.5, difficultySource: 'predicted', difficultyReason: '一步建模与计算', confidence: 0.8, empiricalSampleSize: null },
    answer: { kind: 'expression', latex: '2x+1', equivalentForms: [] }, explanation: ['依据导数定义计算。'],
    rubric: { totalScore: 10, items: [{ id: 'r1', description: '建立导数', points: 4 }, { id: 'r2', description: '计算结论', points: 6 }], generalRule: '等价过程同分' },
    originality: { similarity: 0.2, notes: '改变情境与设问', variationAxis: '改变信息表征方式' },
    validation: { passed: true, findings: [] }, savedQuestionId: null,
  };
  const job = db.insert(schema.similarQuestionJobs).values({
    requestedBy: 1, course: '高等数学', sourceText: '1. 求函数导数。', status: 'succeeded',
    resultJson: JSON.stringify({ sourceQuestions: [], items: [resultItem] }),
  }).returning().get();
  db.insert(schema.generatedQuestions).values({
    id: 1, similarQuestionJobId: job.id, questionType: 'calculation', stem: JSON.stringify(resultItem.stem),
    subquestions: '[]', score: 10, provider: 'test', model: 'test', promptVersionId: prompt.id, status: 'generated',
  }).run();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/similar-question-jobs', similarQuestionRoutes);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/similar-question-jobs`;
  const request = async (path: string, token: string, options?: { method?: string; body?: unknown }) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() as { success: boolean; data?: Record<string, unknown>; error?: string } };
  };

  try {
    assert.equal((await request(`/${job.id}`, generateToken(3, 'student'))).status, 403);
    assert.equal((await request(`/${job.id}`, generateToken(2, 'teacher'))).status, 403);
    assert.equal((await request(`/${job.id}`, generateToken(1, 'teacher'))).status, 200);

    const saved = await request(`/${job.id}/save`, generateToken(1, 'teacher'), {
      method: 'POST', body: { questionIds: [1] },
    });
    assert.equal(saved.status, 200);
    const question = db.select().from(schema.questions).where(eq(schema.questions.createdBy, 1)).get();
    assert.ok(question);
    assert.equal(question.aiGenerated, true);
    assert.equal(question.status, 'generated');
    assert.match(question.stem, /瞬时变化率/);
    assert.equal(db.select().from(schema.generatedQuestions).where(eq(schema.generatedQuestions.id, 1)).get()?.legacyQuestionId, question.id);

    const savedAgain = await request(`/${job.id}/save`, generateToken(1, 'teacher'), {
      method: 'POST', body: { questionIds: [1] },
    });
    assert.equal(savedAgain.status, 200);
    assert.equal(db.select().from(schema.questions).all().length, 1, 'save must be idempotent');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
