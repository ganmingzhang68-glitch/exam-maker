import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { initDb, db, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import questionRoutes from '../src/routes/question.js';
import paperRoutes from '../src/routes/paper.js';

interface ApiResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
}

test('teacher question review to paper workflow is permission-safe and locks published papers', async () => {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'student@test.local', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other', email: 'other@test.local', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.projects).values({
    id: 1, title: 'AI 出题项目', course: '数学', userId: 1,
  }).run();
  db.insert(schema.projectFiles).values({
    id: 1, projectId: 1, type: 'generated_paper', filename: 'paper-1.tex', filepath: 'paper-1.tex',
  }).run();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/questions', questionRoutes);
  app.use('/api/papers', paperRoutes);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const teacherToken = generateToken(1, 'teacher');
  const studentToken = generateToken(2, 'student');
  const otherToken = generateToken(3, 'teacher');

  async function request<T>(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: ApiResult<T> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() as ApiResult<T> };
  }

  try {
    const studentList = await request('/questions', { token: studentToken });
    assert.equal(studentList.status, 403);

    const created = await request<{ id: number; status: string }>('/questions', {
      method: 'POST', token: teacherToken,
      body: {
        sourceFileId: 1,
        sourceProjectId: 1,
        sourceQuestionNo: '1.1',
        type: 'single_choice',
        stem: 'AI 原始题干',
        options: ['A', 'B'],
        answerKey: { option: 'A' },
        difficulty: 'medium',
        defaultScore: 5,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data?.status, 'generated');
    const questionId = created.body.data!.id;

    const edited = await request<{ stem: string }>(`/questions/${questionId}`, {
      method: 'PATCH', token: teacherToken, body: { stem: '教师修改后的题干' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data?.stem, '教师修改后的题干');
    assert.equal(db.select().from(schema.questionVersions).all().length, 1, 'editing creates an immutable prior version');

    const invalidChoiceEdit = await request(`/questions/${questionId}`, {
      method: 'PATCH', token: teacherToken, body: { options: ['只有一个选项'] },
    });
    assert.equal(invalidChoiceEdit.status, 400);

    const reviewed = await request<{ status: string }>(`/questions/${questionId}/review`, {
      method: 'PATCH', token: teacherToken, body: { status: 'reviewed' },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.data?.status, 'reviewed');

    const rejected = await request<{ id: number }>('/questions', {
      method: 'POST', token: teacherToken,
      body: { type: 'true_false', stem: '应被拒绝的题目', defaultScore: 2, status: 'rejected' },
    });
    const rejectedId = rejected.body.data!.id;
    const second = await request<{ id: number }>('/questions', {
      method: 'POST', token: teacherToken,
      body: { type: 'fill_blank', stem: '第二题', defaultScore: 3, difficulty: 'basic', status: 'reviewed' },
    });
    const secondId = second.body.data!.id;

    const filtered = await request<Array<{ id: number; sourceFileName: string }>>(
      '/questions?status=reviewed&type=single_choice&difficulty=medium&sourceFileId=1',
      { token: teacherToken },
    );
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.data?.map((item) => item.id), [questionId]);
    assert.equal(filtered.body.data?.[0].sourceFileName, 'paper-1.tex');

    const productFiltered = await request<Array<{ id: number; origin: string; usageCount: number }>>(
      '/questions?search=教师修改&origin=past_exam&lifecycleStatus=approved&usage=unused&sort=score_desc',
      { token: teacherToken },
    );
    assert.deepEqual(productFiltered.body.data?.map((item) => item.id), [questionId]);

    const paperCreated = await request<{ id: number; totalScore: number }>('/papers', {
      method: 'POST', token: teacherToken,
      body: { title: '期中测试卷', course: '数学', durationMinutes: 90 },
    });
    assert.equal(paperCreated.status, 201);
    assert.equal(paperCreated.body.data?.totalScore, 0);
    const paperId = paperCreated.body.data!.id;

    const forbiddenOwner = await request(`/papers/${paperId}`, { token: otherToken });
    assert.equal(forbiddenOwner.status, 403);

    const rejectedAdd = await request(`/papers/${paperId}/questions`, {
      method: 'POST', token: teacherToken, body: { questionId: rejectedId },
    });
    assert.equal(rejectedAdd.status, 409);

    const firstAdd = await request<{ totalScore: number; questions: Array<{ id: number }> }>(
      `/papers/${paperId}/questions`,
      { method: 'POST', token: teacherToken, body: { questionId, score: 6 } },
    );
    assert.equal(firstAdd.status, 201);
    assert.equal(firstAdd.body.data?.totalScore, 6);
    const firstPaperQuestionId = firstAdd.body.data!.questions[0].id;

    const secondAdd = await request<{ totalScore: number; questions: Array<{ id: number }> }>(
      `/papers/${paperId}/questions`,
      { method: 'POST', token: teacherToken, body: { questionId: secondId } },
    );
    assert.equal(secondAdd.body.data?.totalScore, 9);
    const secondPaperQuestionId = secondAdd.body.data!.questions[1].id;

    const scoreUpdated = await request<{ totalScore: number }>(
      `/papers/${paperId}/questions/${secondPaperQuestionId}`,
      { method: 'PATCH', token: teacherToken, body: { score: 4 } },
    );
    assert.equal(scoreUpdated.body.data?.totalScore, 10);

    const reordered = await request<{ questions: Array<{ id: number; orderNo: number }> }>(
      `/papers/${paperId}/questions/reorder`,
      {
        method: 'PATCH', token: teacherToken,
        body: { paperQuestionIds: [secondPaperQuestionId, firstPaperQuestionId] },
      },
    );
    assert.deepEqual(
      reordered.body.data?.questions.map((item) => [item.id, item.orderNo]),
      [[secondPaperQuestionId, 1], [firstPaperQuestionId, 2]],
    );

    db.insert(schema.exams).values({
      paperId, createdBy: 1, title: '已发布考试', status: 'published', publishedAt: new Date().toISOString(),
    }).run();
    const lockedEdit = await request(`/papers/${paperId}`, {
      method: 'PATCH', token: teacherToken, body: { title: '不应被修改' },
    });
    assert.equal(lockedEdit.status, 409);
    const lockedScore = await request(`/papers/${paperId}/questions/${firstPaperQuestionId}`, {
      method: 'PATCH', token: teacherToken, body: { score: 99 },
    });
    assert.equal(lockedScore.status, 409);

    const copiedPaper = await request<{ id: number; questions: Array<{ questionId: number }> }>(`/papers/${paperId}/copy`, { method: 'POST', token: teacherToken });
    assert.equal(copiedPaper.status, 201);
    assert.deepEqual(copiedPaper.body.data?.questions.map((item) => item.questionId), [secondId, questionId]);

    const archivePaper = await request(`/papers/${paperId}`, { method: 'DELETE', token: teacherToken });
    assert.equal(archivePaper.status, 200);
    assert.equal(db.select().from(schema.papers).all().find((item) => item.id === paperId)?.status, 'archived');

    const safeDelete = await request(`/questions/${questionId}`, { method: 'DELETE', token: teacherToken });
    assert.equal(safeDelete.status, 200);
    assert.equal(db.select().from(schema.questions).all().find((item) => item.id === questionId)?.lifecycleStatus, 'archived');
    assert.ok(db.select().from(schema.questions).all().some((item) => item.id === questionId), 'used question is never physically deleted');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
