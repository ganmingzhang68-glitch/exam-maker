import assert from 'node:assert/strict'; import test from 'node:test'; import type { AddressInfo } from 'node:net'; import express from 'express';
import { db, initDb, schema } from '../src/db/index.js'; import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js'; import { errorHandler } from '../src/middleware/errorHandler.js'; import routes from '../src/routes/teachingAnalytics.js';

test('teaching analytics persists snapshots and explains attention rules with role scoping', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([{ id: 1, username: 'teacher', email: 'ta-t@test', passwordHash: 'x', role: 'teacher' }, { id: 2, username: 'student-a', email: 'ta-a@test', passwordHash: 'x', role: 'student' }, { id: 3, username: 'student-b', email: 'ta-b@test', passwordHash: 'x', role: 'student' }, { id: 4, username: 'other', email: 'ta-o@test', passwordHash: 'x', role: 'teacher' }]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '统计学', status: 'active' }).run(); db.insert(schema.teachingClasses).values({ id: 1, courseId: 1, teacherUserId: 1, name: '一班' }).run();
  db.insert(schema.enrollments).values([{ id: 1, classId: 1, studentId: 2 }, { id: 2, classId: 1, studentId: 3 }]).run();
  db.insert(schema.papers).values([{ id: 1, createdBy: 1, courseId: 1, title: '卷一', course: '统计学', totalScore: 100 }, { id: 2, createdBy: 1, courseId: 1, title: '卷二', course: '统计学', totalScore: 100 }]).run();
  db.insert(schema.exams).values([{ id: 1, paperId: 1, createdBy: 1, title: '考试一', status: 'published' }, { id: 2, paperId: 2, createdBy: 1, title: '考试二', status: 'published' }]).run();
  db.insert(schema.examAssignments).values([{ id: 1, examId: 1, studentId: 2 }, { id: 2, examId: 2, studentId: 2 }, { id: 3, examId: 1, studentId: 3 }, { id: 4, examId: 2, studentId: 3 }]).run();
  db.insert(schema.attempts).values([{ id: 1, examId: 1, assignmentId: 1, studentId: 2, status: 'graded', totalScore: 90, gradedAt: '2026-01-01T00:00:00Z' }, { id: 2, examId: 2, assignmentId: 2, studentId: 2, status: 'graded', totalScore: 50, gradedAt: '2026-02-01T00:00:00Z' }]).run();
  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/teaching-analytics', routes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); }); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/teaching-analytics`;
  const call = async (path: string, userId: number, method = 'GET') => { const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${generateToken(userId, 'teacher')}` } }); return { status: response.status, body: await response.json() as { data?: any } }; };
  try {
    const refreshed = await call('/courses/1/refresh', 1, 'POST'); assert.equal(refreshed.status, 201); assert.equal(refreshed.body.data.summary.participationRate, 0.5); assert.equal(refreshed.body.data.summary.averageScoreRate, 0.7);
    assert.deepEqual(refreshed.body.data.attentionStudents.find((item: any) => item.studentId === 2).reasons, ['score_decline']);
    assert.deepEqual(refreshed.body.data.attentionStudents.find((item: any) => item.studentId === 3).reasons, ['missed_submission']);
    assert.equal(db.select().from(schema.teachingAnalyticsSnapshots).all().length, 1); assert.equal((await call('/courses/1', 1)).body.data.id, refreshed.body.data.id); assert.equal((await call('/courses/1', 4)).status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
