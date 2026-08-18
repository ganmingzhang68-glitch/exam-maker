import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { organizationMiddleware } from '../src/middleware/organization.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import courseRoutes from '../src/routes/course.js';
import classRoutes from '../src/routes/teachingClass.js';
import examRoutes from '../src/routes/exam.js';

test('implicit organization scope, enrollment and exam publication stay tenant isolated', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'admin', email: 'tenant-admin@test.local', passwordHash: 'x', role: 'admin' },
    { id: 2, username: 'teacher', email: 'tenant-teacher@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 3, username: 'orphan', email: 'tenant-orphan@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 4, username: 'student-a', email: 'tenant-a@test.local', passwordHash: 'x', role: 'student' },
    { id: 5, username: 'student-b', email: 'tenant-b@test.local', passwordHash: 'x', role: 'student' },
  ]).run();
  db.insert(schema.organizations).values({ id: 2, name: '第二学校', code: 'tenant-two', createdBy: 1 }).run();
  db.insert(schema.userOrganizations).values([
    { userId: 1, organizationId: 1, role: 'admin', isDefault: true },
    { userId: 2, organizationId: 1, role: 'member', isDefault: true },
    { userId: 2, organizationId: 2, role: 'member', isDefault: false },
    { userId: 4, organizationId: 1, role: 'member', isDefault: true },
    { userId: 5, organizationId: 2, role: 'member', isDefault: true },
  ]).run();
  db.insert(schema.courses).values([
    { id: 1, ownerUserId: 2, organizationId: 1, name: '组织一课程', status: 'active' },
    { id: 2, ownerUserId: 2, organizationId: 2, name: '组织二课程', status: 'active' },
  ]).run();
  db.insert(schema.teachingClasses).values({ id: 1, courseId: 2, organizationId: 2, teacherUserId: 2, name: '二校一班' }).run();
  db.insert(schema.questions).values({ id: 1, createdBy: 2, organizationId: 2, courseId: 2, type: 'single_choice', stem: '1+1=?', options: '["A.1","B.2"]', answerKey: '{"option":"B.2"}', defaultScore: 10, status: 'reviewed', lifecycleStatus: 'approved' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 2, organizationId: 2, courseId: 2, title: '二校试卷', course: '组织二课程', totalScore: 10, status: 'draft' }).run();
  db.insert(schema.paperQuestions).values({ id: 1, paperId: 1, questionId: 1, orderNo: 1, score: 10 }).run();
  db.insert(schema.exams).values({ id: 1, paperId: 1, organizationId: 2, createdBy: 2, title: '二校考试', status: 'draft', startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30 }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use(organizationMiddleware);
  app.use('/api/courses', courseRoutes); app.use('/api/classes', classRoutes); app.use('/api/exams', examRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, userId: number, role: 'teacher' | 'student', method = 'GET', body?: unknown, organizationId?: number) => fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${generateToken(userId, role)}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(organizationId ? { 'x-organization-id': String(organizationId) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const implicit = await (await call('/courses', 2, 'teacher')).json() as { data: Array<{ id: number }> };
    assert.deepEqual(implicit.data.map(item => item.id), [1], 'default organization must scope list APIs even without an explicit header');
    assert.equal((await call('/courses', 3, 'teacher')).status, 403, 'a user without membership must not fall back to organization 1');
    const candidates = await (await call('/classes/1/students/search', 2, 'teacher', 'GET', undefined, 2)).json() as { data: Array<{ id: number }> };
    assert.deepEqual(candidates.data.map(item => item.id), [5]);
    assert.equal((await call('/classes/1/enrollments', 2, 'teacher', 'POST', { studentIds: [4] }, 2)).status, 400);
    assert.equal((await call('/exams/1/results', 2, 'teacher', 'GET', undefined, 1)).status, 403);
    assert.equal((await call('/exams/1/quality', 2, 'teacher', 'GET', undefined, 1)).status, 403);
    assert.equal((await call('/exams/1/publish', 2, 'teacher', 'POST', undefined, 2)).status, 200);
    assert.deepEqual(db.select({ studentId: schema.examAssignments.studentId }).from(schema.examAssignments).where(eq(schema.examAssignments.examId, 1)).all().map(item => item.studentId), [5]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
