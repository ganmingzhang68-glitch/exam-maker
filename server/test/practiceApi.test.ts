import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import practiceRoutes from '../src/routes/practice.js';
import { syncStudentCourseMastery } from '../src/services/knowledgeMastery.js';

test('practice creates a bank-backed plan, exposes shortages, grades answers and preserves role isolation', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'practice-teacher@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'practice-student@test.local', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other', email: 'practice-other@test.local', passwordHash: 'x', role: 'student' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '程序设计', status: 'active' }).run();
  db.insert(schema.teachingClasses).values({ id: 1, courseId: 1, teacherUserId: 1, name: '一班' }).run();
  db.insert(schema.enrollments).values({ id: 1, classId: 1, studentId: 2 }).run();
  db.insert(schema.knowledgePoints).values({ id: 1, courseId: 1, code: 'loop', name: '循环', status: 'confirmed' }).run();
  for (let id = 1; id <= 4; id += 1) db.insert(schema.questions).values({ id, createdBy: 1, courseId: 1,
    type: 'single_choice', stem: `循环题 ${id}`, options: JSON.stringify(['A', 'B']), answerKey: JSON.stringify({ option: 'A' }),
    analysis: 'A 为正确选项', defaultScore: 2, knowledgePoints: JSON.stringify(['循环']),
    status: id === 4 ? 'generated' : 'reviewed', lifecycleStatus: id === 4 ? 'draft' : 'approved' }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/practice', practiceRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/practice`;
  const call = async (path: string, token: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as { data?: any; error?: string } };
  };
  const student = generateToken(2, 'student');
  try {
    assert.equal((await call('/options', generateToken(1, 'teacher'))).status, 403);
    assert.equal((await call('/sessions', generateToken(3, 'student'), 'POST', { courseId: 1, mode: 'knowledge_point', knowledgePointId: 1, questionCount: 3 })).status, 403);
    const created = await call('/sessions', student, 'POST', { courseId: 1, mode: 'knowledge_point', knowledgePointId: 1, questionCount: 5 });
    assert.equal(created.status, 201); assert.equal(created.body.data.selectedCount, 3); assert.equal(created.body.data.shortageCount, 2);
    assert.equal(created.body.data.plan.shortages[0].code, 'QUESTION_BANK_SHORTAGE');
    assert.equal('answerKey' in created.body.data.questions[0], false, 'answer must not leak before completion');
    const sessionId = created.body.data.id;
    const firstItem = created.body.data.questions[0];
    assert.equal((await call(`/sessions/${sessionId}/items/${firstItem.id}`, student, 'PUT', { content: 'A', timeSpentSeconds: 5 })).status, 200);
    const overwritten = await call(`/sessions/${sessionId}/items/${firstItem.id}`, student, 'PUT', { content: 'B', timeSpentSeconds: 1 });
    assert.equal(overwritten.status, 409, 'a graded practice item must be immutable');
    for (const item of created.body.data.questions.slice(1)) {
      const answer = await call(`/sessions/${sessionId}/items/${item.id}`, student, 'PUT', { content: 'A', timeSpentSeconds: 5 });
      assert.equal(answer.status, 200);
    }
    const completed = await call(`/sessions/${sessionId}`, student);
    assert.equal(completed.body.data.status, 'completed'); assert.equal(completed.body.data.scoreEarned, 6);
    assert.deepEqual(completed.body.data.questions[0].answerKey, { option: 'A' });
    assert.equal((await call(`/sessions/${sessionId}`, generateToken(3, 'student'))).status, 404);
    const mastery = syncStudentCourseMastery(2, 1).find(item => item.knowledgePointId === 1)!;
    assert.equal(mastery.questionCount, 3); assert.equal(mastery.scoreRate, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('practice schema requires a knowledge point only for knowledge-point mode', async () => {
  const { createPracticeSessionSchema } = await import('@exam-maker/shared');
  assert.equal(createPracticeSessionSchema.safeParse({ courseId: 1, mode: 'knowledge_point', questionCount: 5 }).success, false);
  assert.equal(createPracticeSessionSchema.safeParse({ courseId: 1, mode: 'weak_points', knowledgePointId: 2, questionCount: 5 }).success, false);
  assert.equal(createPracticeSessionSchema.safeParse({ courseId: 1, mode: 'weak_points', questionCount: 5 }).success, true);
});
