import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import dashboardRoutes from '../src/routes/dashboard.js';
import examRoutes from '../src/routes/exam.js';

interface ApiResult<T = Record<string, unknown>> { success: boolean; data?: T; error?: string }

test('role dashboards aggregate owned data and expired attempts are finalized by the backend', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@dashboard.test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'student@dashboard.test', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other_student', email: 'other@dashboard.test', passwordHash: 'x', role: 'student' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '高等数学', status: 'active' }).run();
  db.insert(schema.teachingClasses).values({ id: 1, courseId: 1, teacherUserId: 1, name: '一班', status: 'active' }).run();
  db.insert(schema.enrollments).values({ classId: 1, studentId: 2, status: 'active' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, title: '测试卷', course: '高等数学', totalScore: 5, status: 'ready' }).run();
  db.insert(schema.questions).values({ id: 1, createdBy: 1, type: 'single_choice', stem: '1+1=?', options: '["1","2"]', answerKey: '{"option":"2"}', defaultScore: 5, status: 'reviewed' }).run();
  db.insert(schema.paperQuestions).values({ id: 1, paperId: 1, questionId: 1, orderNo: 1, score: 5, questionSnapshot: JSON.stringify({ type: 'single_choice', stem: '1+1=?', options: ['1', '2'], answerKey: { option: '2' } }) }).run();
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: '限时测验', status: 'published', startAt: past, endAt: future, durationMinutes: 10, allowedAttempts: 1, publishedAt: past }).run();
  db.insert(schema.examAssignments).values({ id: 1, examId: 1, studentId: 2, dueAt: future }).run();
  db.insert(schema.attempts).values({
    id: 1, examId: 1, assignmentId: 1, studentId: 2, attemptNo: 1, status: 'in_progress', startedAt: past,
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    paperSnapshot: JSON.stringify({ paper: { id: 1, title: '测试卷', course: '高等数学', instructions: null, totalScore: 5 }, questions: [{ paperQuestionId: 1, questionId: 1, orderNo: 1, sectionTitle: null, score: 5, type: 'single_choice', stem: '1+1=?', options: ['1', '2'] }] }),
  }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware);
  app.use('/api/dashboard', dashboardRoutes); app.use('/api/exams', examRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const port = (server.address() as AddressInfo).port;
  const teacher = generateToken(1, 'teacher'); const student = generateToken(2, 'student');
  async function request<T>(path: string, token: string) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() as ApiResult<T> };
  }
  try {
    assert.equal((await request('/dashboard/teacher', student)).status, 403);
    assert.equal((await request('/dashboard/student', teacher)).status, 403);
    const teacherData = await request<{ metrics: { activeCourseCount: number; activeClassCount: number; ongoingExamCount: number }; recentExams: Array<{ classNames: string[] }> }>('/dashboard/teacher', teacher);
    assert.deepEqual(teacherData.body.data?.metrics, { activeCourseCount: 1, activeClassCount: 1, ongoingExamCount: 1, pendingGradingCount: 0, weeklySubmissionCount: 0 });
    assert.deepEqual(teacherData.body.data?.recentExams[0].classNames, ['一班']);

    const studentData = await request<{ exams: Array<{ displayStatus: string; latestAttempt: { status: string } }>; courses: Array<{ className: string }>; metrics: { completedCount: number } }>('/dashboard/student', student);
    assert.equal(studentData.body.data?.exams[0].displayStatus, 'graded');
    assert.equal(studentData.body.data?.exams[0].latestAttempt.status, 'graded');
    assert.equal(studentData.body.data?.metrics.completedCount, 1);
    assert.equal(studentData.body.data?.courses[0].className, '一班');
    assert.equal(db.select().from(schema.attempts).all()[0].status, 'graded', 'expired in-progress attempt must be finalized server-side');

    const mine = await request<Array<{ displayStatus: string; availability: string }>>('/exams/mine', student);
    assert.deepEqual(mine.body.data?.map((item) => [item.displayStatus, item.availability]), [['graded', 'completed']]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
