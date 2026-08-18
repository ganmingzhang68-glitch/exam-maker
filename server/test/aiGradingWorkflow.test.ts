import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import examRoutes from '../src/routes/exam.js';
import { queueAiGradingSuggestion, resumeAiGradingSuggestions, runAiGradingSuggestion } from '../src/services/aiGrading.js';
import { calculateGradingCalibration } from '../src/services/gradingCalibration.js';

test('grading calibration suppresses small samples and computes real teacher differences', () => {
  const row = { aiScore: 8, teacherScore: 7, decision: 'modified' as const, questionType: 'essay', rubricKey: 'r1' };
  assert.equal(calculateGradingCalibration([row]).status, 'insufficient_sample');
  const summary = calculateGradingCalibration([
    row,
    { ...row, aiScore: 6, teacherScore: 7 },
    { ...row, aiScore: 7, teacherScore: 7, decision: 'accepted' },
    { ...row, aiScore: 7, teacherScore: 7, decision: 'accepted' },
    { ...row, aiScore: 7, teacherScore: 7, decision: 'accepted' },
  ]);
  assert.equal(summary.status, 'available');
  assert.equal(summary.mae, 0.4);
  assert.equal(summary.bias, 0);
  assert.equal(summary.acceptanceRate, 0.6);
});

test('AI suggestion remains advisory until an authorized teacher accepts it', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'owner', email: 'ai-grade-owner@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'ai-grade-student@test.local', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other', email: 'ai-grade-other@test.local', passwordHash: 'x', role: 'teacher' },
  ]).run();
  const rubric = { totalScore: 10, items: [
    { id: 'r1', description: '写出定义', points: 4, acceptableExpressions: [], equivalentSolutions: [], partialCreditRule: '部分正确得2分' },
    { id: 'r2', description: '完成论证', points: 6, acceptableExpressions: [], equivalentSolutions: [], partialCreditRule: '过程正确可得4分' },
  ], generalRule: '不重复扣分' };
  db.insert(schema.questions).values({ id: 1, createdBy: 1, type: 'essay', stem: '说明并证明结论', answerKey: JSON.stringify({ text: '定义和完整论证' }),
    scoringRubric: JSON.stringify(rubric), defaultScore: 10, status: 'reviewed' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, title: 'AI批改试卷', course: '测试', totalScore: 10 }).run();
  db.insert(schema.paperQuestions).values({ id: 1, paperId: 1, questionId: 1, orderNo: 1, score: 10,
    questionSnapshot: JSON.stringify({ type: 'essay', stem: '说明并证明结论', answerKey: { text: '定义和完整论证' }, scoringRubric: rubric }) }).run();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: 'AI批改考试', status: 'published' }).run();
  db.insert(schema.examAssignments).values({ id: 1, examId: 1, studentId: 2 }).run();
  db.insert(schema.attempts).values({ id: 1, examId: 1, assignmentId: 1, studentId: 2, status: 'grading', paperSnapshot: JSON.stringify({
    paper: { id: 1, title: 'AI批改试卷', course: '测试', instructions: null, totalScore: 10 },
    questions: [{ paperQuestionId: 1, questionId: 1, orderNo: 1, sectionTitle: null, score: 10, type: 'essay', stem: '说明并证明结论', options: null }],
  }) }).run();
  db.insert(schema.answers).values({ id: 1, attemptId: 1, paperQuestionId: 1, content: JSON.stringify('定义正确，论证缺少最后一步。'), gradingStatus: 'ungraded' }).run();

  const queued = queueAiGradingSuggestion(1);
  assert.equal(queued.status, 'queued');
  const completed = await runAiGradingSuggestion(queued.id, { transport: async () => ({ text: JSON.stringify({
    status: 'ok', suggestedScore: 7, maxScore: 10,
    rubricItemScores: [
      { rubricItemId: 'r1', awardedScore: 4, maxScore: 4, evidenceSummary: '定义正确', matched: ['定义'], missing: [] },
      { rubricItemId: 'r2', awardedScore: 3, maxScore: 6, evidenceSummary: '论证不完整', matched: ['主要步骤'], missing: ['最后一步'] },
    ], reasoningSummary: '定义正确，论证不完整。', matchedPoints: ['定义', '主要步骤'], missingPoints: ['最后一步'], confidence: 0.8, issues: [],
  }), inputTokens: 100, outputTokens: 80 }) });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.suggestedScore, 7);
  assert.equal(db.select().from(schema.answers).where(eq(schema.answers.id, 1)).get()?.finalScore, null, 'AI must not finalize a grade');
  assert.equal(db.select().from(schema.aiRuns).all().length, 1);

  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/exams', examRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  const call = async (userId: number, method: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/exams/1/attempts/1/answers/1/${method === 'GET' ? 'ai-suggestion' : 'grade'}`, {
      method, headers: { Authorization: `Bearer ${generateToken(userId, 'teacher')}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as { data?: { attempt: { totalScore: number } } } };
  };
  try {
    assert.equal((await call(3, 'GET')).status, 403);
    const accepted = await call(1, 'PATCH', { score: 7, feedback: '教师确认', aiSuggestionId: completed.id, gradingMode: 'accept_ai' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data?.attempt.totalScore, 7);
    assert.equal(db.select().from(schema.aiGradingSuggestions).get()?.status, 'accepted');
    assert.equal(db.select().from(schema.answers).get()?.gradedBy, 1);
    db.update(schema.aiGradingSuggestions).set({ status: 'running' }).where(eq(schema.aiGradingSuggestions.id, completed.id)).run();
    const scheduled: number[] = [];
    assert.equal(resumeAiGradingSuggestions(id => scheduled.push(id)), 1);
    assert.deepEqual(scheduled, [completed.id]);
    assert.equal(db.select().from(schema.aiGradingSuggestions).get()?.status, 'queued');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
