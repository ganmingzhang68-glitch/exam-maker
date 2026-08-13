import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import learningRoutes from '../src/routes/learning.js';
import { calculateMasteryEvidence } from '../src/services/knowledgeMastery.js';

test('knowledge mastery uses score weights, recency and an explicit small-sample state', () => {
  const now = new Date('2026-08-13T00:00:00.000Z');
  const insufficient = calculateMasteryEvidence([{ examId: 1, earnedScore: 10, possibleScore: 10, assessedAt: now.toISOString() }], now);
  assert.equal(insufficient.scoreRate, 1);
  assert.equal(insufficient.masteryLevel, 'insufficient_data');
  const result = calculateMasteryEvidence([
    { examId: 1, earnedScore: 10, possibleScore: 10, assessedAt: now.toISOString() },
    { examId: 1, earnedScore: 5, possibleScore: 10, assessedAt: now.toISOString() },
    { examId: 2, earnedScore: 0, possibleScore: 10, assessedAt: now.toISOString() },
  ], now);
  assert.equal(result.scoreRate, 0.5);
  assert.equal(result.recentScoreRate, 0.5);
  assert.equal(result.masteryLevel, 'developing');
  assert.equal(result.assessmentCount, 2);
});

test('student and teacher knowledge analytics are role scoped and use graded answers', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values([
    { id: 1, username: 'teacher', email: 'mastery-teacher@test.local', passwordHash: 'x', role: 'teacher' },
    { id: 2, username: 'student', email: 'mastery-student@test.local', passwordHash: 'x', role: 'student' },
    { id: 3, username: 'other', email: 'mastery-other@test.local', passwordHash: 'x', role: 'teacher' },
  ]).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '线性代数', status: 'active' }).run();
  db.insert(schema.teachingClasses).values({ id: 1, courseId: 1, teacherUserId: 1, name: '一班' }).run();
  db.insert(schema.enrollments).values({ id: 1, classId: 1, studentId: 2 }).run();
  db.insert(schema.knowledgePoints).values([
    { id: 1, courseId: 1, code: 'matrix', name: '矩阵', status: 'confirmed' },
    { id: 2, courseId: 1, parentId: 1, code: 'inverse', name: '逆矩阵', status: 'confirmed' },
  ]).run();
  for (let id = 1; id <= 3; id += 1) db.insert(schema.questions).values({ id, createdBy: 1, courseId: 1,
    type: 'calculation', stem: `逆矩阵题 ${id}`, knowledgePoints: JSON.stringify(['逆矩阵']), defaultScore: 10 }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, courseId: 1, title: '掌握分析试卷', course: '线性代数', totalScore: 30 }).run();
  for (let id = 1; id <= 3; id += 1) db.insert(schema.paperQuestions).values({ id, paperId: 1, questionId: id, orderNo: id, score: 10 }).run();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: '掌握分析考试', status: 'published' }).run();
  db.insert(schema.examAssignments).values({ id: 1, examId: 1, studentId: 2 }).run();
  db.insert(schema.attempts).values({ id: 1, examId: 1, assignmentId: 1, studentId: 2, status: 'graded', gradedAt: new Date().toISOString() }).run();
  for (let id = 1; id <= 3; id += 1) db.insert(schema.answers).values({ id, attemptId: 1, paperQuestionId: id,
    finalScore: [10, 5, 0][id - 1], gradingStatus: 'manual_graded' }).run();

  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/learning', learningRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  const call = async (path: string, userId: number, role: 'teacher' | 'student') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${generateToken(userId, role)}` } });
    return { status: response.status, body: await response.json() as { data?: Record<string, unknown> } };
  };
  try {
    const student = await call('/api/learning/student', 2, 'student');
    assert.equal(student.status, 200);
    const courses = student.body.data?.courses as Array<{ knowledgePoints: Array<{ knowledgePointName: string; scoreRate: number; masteryLevel: string; timeSpentSeconds: null }> }>;
    const inverse = courses[0].knowledgePoints.find(point => point.knowledgePointName === '逆矩阵')!;
    assert.equal(inverse.scoreRate, 0.5); assert.equal(inverse.masteryLevel, 'developing'); assert.equal(inverse.timeSpentSeconds, null);
    const teacher = await call('/api/learning/courses/1', 1, 'teacher');
    assert.equal(teacher.status, 200);
    assert.equal((teacher.body.data?.items as Array<{ knowledgePointName: string; averageScoreRate: number }>).find(item => item.knowledgePointName === '逆矩阵')?.averageScoreRate, 0.5);
    assert.equal((await call('/api/learning/courses/1', 3, 'teacher')).status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
