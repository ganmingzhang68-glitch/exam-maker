import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import teachingClassRoutes from '../src/routes/teachingClass.js';

interface ApiResult<T = Record<string, unknown>> { success: boolean; data?: T; error?: string }

test('class enrollment workflow keeps user identity normalized and enforces ownership', async () => {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@class.test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other@class.test', passwordHash: 'x', role: 'teacher' },
    { id: 3, username: 'student_one', email: 'one@class.test', passwordHash: 'x', role: 'student' },
    { id: 4, username: 'student_two', email: 'two@class.test', passwordHash: 'x', role: 'student' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '数据结构', status: 'active' }).run();
  db.insert(schema.courses).values({ id: 2, ownerUserId: 2, name: '其他课程', status: 'active' }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware);
  app.use('/api/classes', teachingClassRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  const teacher = generateToken(1, 'teacher');
  const other = generateToken(2, 'teacher');
  const student = generateToken(3, 'student');
  async function request<T>(path = '', options: { method?: string; token?: string; body?: unknown } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}/api/classes${path}`, {
      method: options.method ?? 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() as ApiResult<T> };
  }

  try {
    assert.equal((await request('', { token: student })).status, 403);
    const forbiddenCourse = await request('', { method: 'POST', token: teacher, body: { courseId: 2, name: '越权班级' } });
    assert.equal(forbiddenCourse.status, 403);

    const created = await request<{ id: number; courseName: string; studentCount: number }>('', {
      method: 'POST', token: teacher, body: { courseId: 1, name: '2026 级一班', semester: '2026 秋季' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data?.courseName, '数据结构');
    const classId = created.body.data!.id;
    assert.equal((await request(`/${classId}`, { token: other })).status, 403);

    const candidates = await request<Array<{ id: number; enrollmentStatus: string | null }>>(`/${classId}/students/search?q=student`, { token: teacher });
    assert.deepEqual(candidates.body.data?.map((item) => item.id), [3, 4]);
    assert.deepEqual(candidates.body.data?.map((item) => item.enrollmentStatus), [null, null]);

    const invalidMember = await request(`/${classId}/enrollments`, { method: 'POST', token: teacher, body: { studentIds: [2] } });
    assert.equal(invalidMember.status, 400);
    const added = await request<{ added: number[] }>(`/${classId}/enrollments`, { method: 'POST', token: teacher, body: { studentIds: [3] } });
    assert.deepEqual(added.body.data?.added, [3]);

    const imported = await request<{ added: number[]; missing: string[] }>(`/${classId}/enrollments/import`, {
      method: 'POST', token: teacher, body: { studentIdentifiers: ['two@class.test', 'missing@class.test'] },
    });
    assert.deepEqual(imported.body.data?.added, [4]);
    assert.deepEqual(imported.body.data?.missing, ['missing@class.test']);

    const detail = await request<{ studentCount: number; students: Array<{ id: number; enrollmentStatus: string }> }>(`/${classId}`, { token: teacher });
    assert.equal(detail.body.data?.studentCount, 2);
    assert.equal(detail.body.data?.students.length, 2);
    assert.equal(db.select().from(schema.users).all().length, 4, 'enrollment must not copy or create user rows');

    assert.equal((await request(`/${classId}/enrollments/3`, { method: 'DELETE', token: teacher })).status, 200);
    const removed = db.select().from(schema.enrollments).all().find((row) => row.studentId === 3);
    assert.equal(removed?.status, 'removed');
    const restored = await request<{ restored: number[] }>(`/${classId}/enrollments`, { method: 'POST', token: teacher, body: { studentIds: [3] } });
    assert.deepEqual(restored.body.data?.restored, [3]);

    await request(`/${classId}`, { method: 'DELETE', token: teacher });
    const archivedAdd = await request(`/${classId}/enrollments`, { method: 'POST', token: teacher, body: { studentIds: [3] } });
    assert.equal(archivedAdd.status, 409);
    assert.equal(db.select().from(schema.enrollments).all().length, 2, 'archiving class preserves enrollments');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
