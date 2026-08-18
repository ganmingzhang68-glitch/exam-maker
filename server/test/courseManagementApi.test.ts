import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import courseRoutes from '../src/routes/course.js';

interface ApiResult<T = Record<string, unknown>> { success: boolean; data?: T; error?: string }

test('course CRUD is schema validated, scoped to its owner, and archive preserves data', async () => {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'teacher@course.test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'other', email: 'other@course.test', passwordHash: 'x', role: 'teacher' },
    { id: 3, username: 'student', email: 'student@course.test', passwordHash: 'x', role: 'student' },
  ]).run();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/courses', courseRoutes);
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/courses`;

  async function request<T>(path = '', options: { method?: string; token?: string; body?: unknown } = {}) {
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

  const teacher = generateToken(1, 'teacher');
  const other = generateToken(2, 'teacher');
  const student = generateToken(3, 'student');
  try {
    const invalid = await request('', { method: 'POST', token: teacher, body: { name: '', unexpected: true } });
    assert.equal(invalid.status, 400);

    const created = await request<{ id: number; name: string; instructorName: string; status: string; summary: { paperCount: number } }>('', {
      method: 'POST', token: teacher,
      body: { name: '高等数学', code: 'MATH-101', semester: '2026 秋季', status: 'active' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data?.instructorName, 'teacher');
    assert.equal(created.body.data?.summary.paperCount, 0);
    const id = created.body.data!.id;

    const duplicate = await request('', { method: 'POST', token: teacher, body: { name: '高等数学' } });
    assert.equal(duplicate.status, 409);
    assert.equal((await request(`/${id}`, { token: other })).status, 403);
    assert.equal((await request('', { token: student })).status, 403);

    const updated = await request<{ semester: string; description: string }>(`/${id}`, {
      method: 'PATCH', token: teacher, body: { semester: '2027 春季', description: '微积分基础课程' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data?.semester, '2027 春季');

    const ownList = await request<Array<{ id: number }>>('?search=MATH&status=active', { token: teacher });
    assert.deepEqual(ownList.body.data?.map((item) => item.id), [id]);
    assert.deepEqual((await request<Array<{ id: number }>>('', { token: other })).body.data, []);

    const archived = await request<{ status: string; archivedAt: string }>(`/${id}`, { method: 'DELETE', token: teacher });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.data?.status, 'archived');
    assert.ok(archived.body.data?.archivedAt);
    assert.equal(db.select().from(schema.courses).all().length, 1, 'archive must not delete the course row');

    const restored = await request<{ status: string; archivedAt: null }>(`/${id}`, {
      method: 'PATCH', token: teacher, body: { status: 'active' },
    });
    assert.equal(restored.body.data?.status, 'active');
    assert.equal(restored.body.data?.archivedAt, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('course migration preserves legacy rows and is safe to rerun', async () => {
  await initDb({ filePath: null });
  runMigrations();
  db.insert(schema.users).values({ id: 10, username: 'legacy', email: 'legacy@course.test', passwordHash: 'x', role: 'teacher' }).run();
  db.insert(schema.courses).values({ id: 10, ownerUserId: 10, name: '历史课程', status: 'active' }).run();
  runMigrations();
  const row = db.select().from(schema.courses).all().find((item) => item.id === 10);
  assert.equal(row?.name, '历史课程');
  assert.equal(row?.status, 'active');
});
