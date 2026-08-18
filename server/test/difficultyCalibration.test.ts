import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import courseRoutes from '../src/routes/course.js';
import { calculateCalibrationSummary, classifyDifficultyPrediction } from '../src/services/difficultyCalibration.js';

test('difficulty calibration labels and aggregates use deterministic calculations', () => {
  assert.equal(classifyDifficultyPrediction(0.3, 0.6, 0.1).label, 'ai_underestimated');
  assert.equal(classifyDifficultyPrediction(0.8, 0.6, 0.1).label, 'ai_overestimated');
  assert.equal(classifyDifficultyPrediction(0.65, 0.6, 0.1).label, 'aligned');
  assert.equal(classifyDifficultyPrediction(null, 0.6).label, 'unavailable');
  assert.deepEqual(calculateCalibrationSummary([0.1, -0.2], 3), {
    sampleSize: 2, status: 'insufficient_sample', mae: null, rmse: null, bias: null,
  });
  const summary = calculateCalibrationSummary([0.1, -0.1], 2);
  assert.equal(summary.status, 'available');
  assert.equal(summary.mae, 0.1);
  assert.equal(summary.bias, 0);
  assert.ok(Math.abs((summary.rmse ?? 0) - 0.1) < 1e-12);
});

test('course calibration API is owner-scoped and preserves original AI predictions', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'owner', email: 'owner-cal@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other-cal@test.local', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '校准课程', status: 'active' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, courseId: 1, title: '校准试卷', course: '校准课程', totalScore: 100 }).run();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: '校准考试' }).run();
  for (let index = 1; index <= 10; index += 1) {
    db.insert(schema.questions).values({ id: index, createdBy: 1, courseId: 1, type: 'single_choice',
      stem: `题目 ${index}`, defaultScore: 10, predictedDifficultyScore: 0.4 }).run();
    db.insert(schema.paperQuestions).values({ id: index, paperId: 1, questionId: index, orderNo: index, score: 10 }).run();
    db.insert(schema.questionQualityReports).values({ id: index, examId: 1, paperQuestionId: index, questionId: index,
      sampleSize: 30, correctRate: 0.4, empiricalDifficulty: 0.6, metricStatus: 'ok' }).run();
  }
  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/courses', courseRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  const call = async (userId: number) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/courses/1/difficulty-calibration`, {
      headers: { Authorization: `Bearer ${generateToken(userId, 'teacher')}` },
    });
    return { status: response.status, body: await response.json() as { data?: { status: string; sampleSize: number; mae: number; records: Array<{ predictedDifficulty: number }> } } };
  };
  try {
    const owner = await call(1);
    assert.equal(owner.status, 200);
    assert.equal(owner.body.data?.status, 'available');
    assert.equal(owner.body.data?.sampleSize, 10);
    assert.ok(Math.abs((owner.body.data?.mae ?? 0) - 0.2) < 1e-12);
    assert.equal((await call(2)).status, 403);
    db.update(schema.questions).set({ predictedDifficultyScore: 0.9 }).where(eq(schema.questions.id, 1)).run();
    const refreshed = await call(1);
    assert.equal(refreshed.body.data?.records[0].predictedDifficulty, 0.4);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
