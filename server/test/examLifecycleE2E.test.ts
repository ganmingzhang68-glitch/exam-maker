import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import bcrypt from 'bcryptjs';
import { initDb, db, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/auth.js';
import questionRoutes from '../src/routes/question.js';
import paperRoutes from '../src/routes/paper.js';
import examRoutes from '../src/routes/exam.js';
import attemptRoutes from '../src/routes/attempt.js';
import { gradeAttempt } from '../src/services/grading.js';

interface ApiEnvelope<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
}

test('E2E teacher publishes an exam and student completes one immutable attempt', async () => {
  await initDb({ filePath: null });
  runMigrations();
  const passwordHash = await bcrypt.hash('Password123!', 4);
  db.insert(schema.users).values([
    { id: 1, username: 'e2e_teacher', email: 'e2e.teacher@test.local', passwordHash, role: 'teacher' },
    { id: 2, username: 'e2e_student', email: 'e2e.student@test.local', passwordHash, role: 'student' },
    { id: 3, username: 'other_student', email: 'other.student@test.local', passwordHash, role: 'student' },
    { id: 4, username: 'other_teacher', email: 'other.teacher@test.local', passwordHash, role: 'teacher' },
  ]).run();
  db.insert(schema.userOrganizations).values([1, 2, 3, 4].map(userId => ({
    userId, organizationId: 1, role: 'member' as const, isDefault: true,
  }))).run();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/auth', authRoutes);
  app.use('/api/questions', questionRoutes);
  app.use('/api/papers', paperRoutes);
  app.use('/api/exams', examRoutes);
  app.use('/api/attempts', attemptRoutes);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  async function request<T>(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: ApiEnvelope<T> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() as ApiEnvelope<T> };
  }

  try {
    const teacherLogin = await request<{ token: string }>('/auth/login', {
      method: 'POST', body: { username: 'e2e_teacher', password: 'Password123!' },
    });
    const studentLogin = await request<{ token: string }>('/auth/login', {
      method: 'POST', body: { username: 'e2e_student', password: 'Password123!' },
    });
    const otherStudentLogin = await request<{ token: string }>('/auth/login', {
      method: 'POST', body: { username: 'other_student', password: 'Password123!' },
    });
    const otherTeacherLogin = await request<{ token: string }>('/auth/login', {
      method: 'POST', body: { username: 'other_teacher', password: 'Password123!' },
    });
    assert.equal(teacherLogin.status, 200);
    assert.equal(studentLogin.status, 200);
    const teacherToken = teacherLogin.body.data!.token;
    const studentToken = studentLogin.body.data!.token;
    const otherStudentToken = otherStudentLogin.body.data!.token;
    const otherTeacherToken = otherTeacherLogin.body.data!.token;
    assert.equal((await request('/exams', { token: studentToken })).status, 403);
    assert.equal((await request('/exams/mine', { token: teacherToken })).status, 403);

    const question = await request<{ id: number }>('/questions', {
      method: 'POST', token: teacherToken,
      body: {
        type: 'single_choice',
        stem: '2 + 2 等于多少？',
        options: ['3', '4', '5'],
        answerKey: { option: '4' },
        analysis: '基础加法',
        difficulty: 'basic',
        defaultScore: 10,
        status: 'reviewed',
      },
    });
    const questionId = question.body.data!.id;
    const subjectiveQuestion = await request<{ id: number }>('/questions', {
      method: 'POST', token: teacherToken,
      body: {
        type: 'short_answer',
        stem: '请说明加法交换律。',
        answerKey: { text: '两个加数交换位置，和不变。' },
        analysis: '考查加法交换律。',
        difficulty: 'basic',
        defaultScore: 10,
        status: 'reviewed',
      },
    });
    const subjectiveQuestionId = subjectiveQuestion.body.data!.id;
    const paper = await request<{ id: number }>('/papers', {
      method: 'POST', token: teacherToken,
      body: { title: 'E2E 数学试卷', course: '数学', durationMinutes: 30 },
    });
    const paperId = paper.body.data!.id;
    const paperWithQuestion = await request<{ questions: Array<{ id: number }> }>(`/papers/${paperId}/questions`, {
      method: 'POST', token: teacherToken, body: { questionId, score: 10 },
    });
    const paperQuestionId = paperWithQuestion.body.data!.questions[0].id;
    const paperWithSubjective = await request<{ questions: Array<{ id: number; questionId: number }> }>(`/papers/${paperId}/questions`, {
      method: 'POST', token: teacherToken, body: { questionId: subjectiveQuestionId, score: 10 },
    });
    const subjectivePaperQuestionId = paperWithSubjective.body.data!.questions
      .find((item) => item.questionId === subjectiveQuestionId)!.id;

    const startAt = new Date(Date.now() - 60_000).toISOString();
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const exam = await request<{ id: number; status: string }>('/exams', {
      method: 'POST', token: teacherToken,
      body: {
        paperId,
        title: 'E2E 考试',
        startAt,
        endAt,
        durationMinutes: 30,
        allowedAttempts: 1,
        fillBlankIgnoreCase: true,
        showAnswers: true,
        showAnalysis: true,
      },
    });
    assert.equal(exam.status, 201);
    assert.equal(exam.body.data?.status, 'draft');
    const examId = exam.body.data!.id;

    const unpublishedStart = await request(`/exams/${examId}/start`, {
      method: 'POST', token: studentToken,
    });
    assert.equal(unpublishedStart.status, 404);
    const beforePublishList = await request<unknown[]>('/exams/mine', { token: studentToken });
    assert.equal(beforePublishList.body.data?.length, 0);

    const published = await request<{ status: string; assignmentCount: number }>(`/exams/${examId}/publish`, {
      method: 'POST', token: teacherToken,
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.data?.status, 'published');
    assert.equal(published.body.data?.assignmentCount, 2);

    const studentExams = await request<Array<{ id: number; availability: string }>>('/exams/mine', {
      token: studentToken,
    });
    assert.deepEqual(studentExams.body.data?.map((item) => [item.id, item.availability]), [[examId, 'available']]);

    const started = await request<{
      attempt: { id: number; status: string; attemptNo: number };
      questions: Array<{ paperQuestionId: number; stem: string }>;
    }>(`/exams/${examId}/start`, { method: 'POST', token: studentToken });
    assert.equal(started.status, 201);
    assert.equal(started.body.data?.attempt.status, 'in_progress');
    assert.equal(started.body.data?.attempt.attemptNo, 1);
    assert.equal(started.body.data?.questions[0].stem, '2 + 2 等于多少？');
    const attemptId = started.body.data!.attempt.id;
    const studentPayload = JSON.stringify(started.body.data);
    assert.equal(studentPayload.includes('answerKey'), false);
    assert.equal(studentPayload.includes('基础加法'), false);
    assert.equal(studentPayload.includes('scoringRubric'), false);

    const restarted = await request<{ attempt: { id: number } }>(`/exams/${examId}/start`, {
      method: 'POST', token: studentToken,
    });
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.data?.attempt.id, attemptId);

    const saved = await request<{ content: string }>(`/attempts/${attemptId}/answers/${paperQuestionId}`, {
      method: 'PUT', token: studentToken, body: { content: '4' },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data?.content, '4');
    const subjectiveSaved = await request<{ content: string }>(`/attempts/${attemptId}/answers/${subjectivePaperQuestionId}`, {
      method: 'PUT', token: studentToken, body: { content: '交换两个加数的位置，结果不变。' },
    });
    assert.equal(subjectiveSaved.body.data?.content, '交换两个加数的位置，结果不变。');

    await request(`/questions/${questionId}`, {
      method: 'PATCH', token: teacherToken, body: { stem: '老师后来修改的题干' },
    });
    const attemptAfterQuestionEdit = await request<{
      questions: Array<{ stem: string }>;
      answers: Array<{ content: string }>;
    }>(`/attempts/${attemptId}`, { token: studentToken });
    assert.equal(attemptAfterQuestionEdit.body.data?.questions[0].stem, '2 + 2 等于多少？');
    assert.equal(attemptAfterQuestionEdit.body.data?.answers[0].content, '4');
    assert.equal(JSON.stringify(attemptAfterQuestionEdit.body.data).includes('answerKey'), false);

    const firstSubmit = await request<{
      attempt: { id: number; status: string; submittedAt: string; objectiveScore: number; subjectiveScore: number; totalScore: number };
      idempotent: boolean;
    }>(`/attempts/${attemptId}/submit`, { method: 'POST', token: studentToken });
    assert.equal(firstSubmit.status, 200);
    assert.equal(firstSubmit.body.data?.attempt.status, 'grading');
    assert.equal(firstSubmit.body.data?.attempt.objectiveScore, 10);
    assert.equal(firstSubmit.body.data?.attempt.subjectiveScore, 0);
    assert.equal(firstSubmit.body.data?.attempt.totalScore, 10);
    assert.equal(firstSubmit.body.data?.idempotent, false);
    const submittedAt = firstSubmit.body.data!.attempt.submittedAt;

    const secondSubmit = await request<{
      attempt: { id: number; submittedAt: string };
      idempotent: boolean;
    }>(`/attempts/${attemptId}/submit`, { method: 'POST', token: studentToken });
    assert.equal(secondSubmit.status, 200);
    assert.equal(secondSubmit.body.data?.attempt.id, attemptId);
    assert.equal(secondSubmit.body.data?.attempt.submittedAt, submittedAt);
    assert.equal(secondSubmit.body.data?.idempotent, true);
    assert.equal(gradeAttempt(attemptId).totalScore, 10);
    assert.equal(gradeAttempt(attemptId).totalScore, 10);

    const resultBeforeManual = await request<{
      attempt: { status: string; totalScore: number };
      questions: Array<{ answerKey?: Record<string, unknown>; analysis?: string }>;
    }>(`/attempts/${attemptId}/result`, { token: studentToken });
    assert.equal(resultBeforeManual.body.data?.attempt.status, 'grading');
    assert.equal(resultBeforeManual.body.data?.attempt.totalScore, 10);
    assert.equal(JSON.stringify(resultBeforeManual.body.data).includes('answerKey'), true);
    assert.equal(JSON.stringify(resultBeforeManual.body.data).includes('考查加法交换律'), true);
    assert.equal((await request(`/attempts/${attemptId}/result`, { token: otherStudentToken })).status, 403);

    const roster = await request<Array<{ student: { id: number }; attempts: Array<{ id: number }> }>>(
      `/exams/${examId}/results`, { token: teacherToken },
    );
    assert.equal(roster.status, 200);
    assert.equal(roster.body.data?.length, 2);
    assert.equal((await request(`/exams/${examId}/results`, { token: otherTeacherToken })).status, 403);

    const gradingDetail = await request<{
      questions: Array<{ subjective: boolean; answer: { id: number } }>;
    }>(`/exams/${examId}/attempts/${attemptId}`, { token: teacherToken });
    const subjectiveAnswerId = gradingDetail.body.data!.questions.find((item) => item.subjective)!.answer.id;
    const excessiveGrade = await request(
      `/exams/${examId}/attempts/${attemptId}/answers/${subjectiveAnswerId}/grade`,
      { method: 'PATCH', token: teacherToken, body: { score: 11, feedback: '超过满分' } },
    );
    assert.equal(excessiveGrade.status, 400);
    const graded = await request<{ attempt: { status: string; subjectiveScore: number; totalScore: number } }>(
      `/exams/${examId}/attempts/${attemptId}/answers/${subjectiveAnswerId}/grade`,
      { method: 'PATCH', token: teacherToken, body: { score: 8, feedback: '要点基本完整' } },
    );
    assert.equal(graded.body.data?.attempt.status, 'graded');
    assert.equal(graded.body.data?.attempt.subjectiveScore, 8);
    assert.equal(graded.body.data?.attempt.totalScore, 18);
    const regraded = await request<{ attempt: { subjectiveScore: number; totalScore: number } }>(
      `/exams/${examId}/attempts/${attemptId}/answers/${subjectiveAnswerId}/grade`,
      { method: 'PATCH', token: teacherToken, body: { score: 7, feedback: '复核后调整' } },
    );
    assert.equal(regraded.body.data?.attempt.subjectiveScore, 7);
    assert.equal(regraded.body.data?.attempt.totalScore, 17);

    const submitAfterGrading = await request<{ attempt: { totalScore: number }; idempotent: boolean }>(
      `/attempts/${attemptId}/submit`, { method: 'POST', token: studentToken },
    );
    assert.equal(submitAfterGrading.body.data?.attempt.totalScore, 17);
    assert.equal(submitAfterGrading.body.data?.idempotent, true);

    const saveAfterSubmit = await request(`/attempts/${attemptId}/answers/${paperQuestionId}`, {
      method: 'PUT', token: studentToken, body: { content: '5' },
    });
    assert.equal(saveAfterSubmit.status, 409);
    const secondAttempt = await request(`/exams/${examId}/start`, { method: 'POST', token: studentToken });
    assert.equal(secondAttempt.status, 409);

    const closed = await request<{ status: string }>(`/exams/${examId}/close`, {
      method: 'POST', token: teacherToken,
    });
    assert.equal(closed.body.data?.status, 'closed');
    assert.equal((await request(`/exams/${examId}/start`, {
      method: 'POST', token: studentToken,
    })).status, 404);

    const futureExam = await request<{ id: number }>('/exams', {
      method: 'POST', token: teacherToken,
      body: {
        paperId,
        title: '尚未开始的考试',
        startAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        endAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        durationMinutes: 30,
        allowedAttempts: 1,
      },
    });
    const futureExamId = futureExam.body.data!.id;
    await request(`/exams/${futureExamId}/publish`, { method: 'POST', token: teacherToken });
    const earlyStart = await request(`/exams/${futureExamId}/start`, {
      method: 'POST', token: studentToken,
    });
    assert.equal(earlyStart.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
