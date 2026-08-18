import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, db, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import exportRoutes from '../src/routes/exportArtifact.js';

test('download API isolates student and teacher artifacts at the backend', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-auth-'));
  const studentPath = join(directory, 'opaque-student.md'); const teacherPath = join(directory, 'opaque-teacher.md');
  writeFileSync(studentPath, '# student paper'); writeFileSync(teacherPath, 'SECRET ANSWER');
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'owner', email: 'owner@test', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'student@test', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other', email: 'other@test', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: 'course' }).run();
  db.insert(schema.projects).values({ id: 1, title: 'p', course: 'course', courseId: 1, userId: 1 }).run();
  db.insert(schema.generationJobs).values({ id: 1, projectId: 1, courseId: 1, requestedBy: 1, pipelineVersion: 'test' }).run();
  db.insert(schema.generatedPapers).values({ id: 1, generationJobId: 1, courseId: 1, title: 'paper', totalScore: 10, selectedAt: new Date().toISOString() }).run();
  db.insert(schema.exportArtifacts).values([
    { id: 1, generatedPaperId: 1, paperVersion: 1, artifactType: 'question_paper', audience: 'student', format: 'markdown', storagePath: studentPath, sha256: 's', contentHash: 's', rendererVersion: 'v', sourcePaperHash: 'p', generationStatus: 'succeeded', validationStatus: 'passed', status: 'ready' },
    { id: 2, generatedPaperId: 1, paperVersion: 1, artifactType: 'answer_key', audience: 'teacher', format: 'markdown', storagePath: teacherPath, sha256: 't', contentHash: 't', rendererVersion: 'v', sourcePaperHash: 'p', generationStatus: 'succeeded', validationStatus: 'passed', status: 'ready' },
  ]).run();
  const app = express(); app.use(authMiddleware); app.use('/api/export-artifacts', exportRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/export-artifacts`;
  const request = (id: number, token: string) => fetch(`${base}/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await request(2, generateToken(2, 'student'))).status, 403);
    assert.equal((await request(1, generateToken(2, 'student'))).status, 200);
    assert.equal((await request(2, generateToken(3, 'teacher'))).status, 403);
    assert.equal((await request(2, generateToken(1, 'teacher'))).status, 200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});
