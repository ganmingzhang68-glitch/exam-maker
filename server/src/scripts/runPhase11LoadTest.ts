import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { authMiddleware, generateToken } from '../middleware/auth.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';
import examRoutes from '../routes/exam.js';
import attemptRoutes from '../routes/attempt.js';

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return { requests: values.length, p50Ms: Number(at(.5).toFixed(1)), p95Ms: Number(at(.95).toFixed(1)), maxMs: Number((sorted.at(-1) ?? 0).toFixed(1)) };
}

async function main() {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values({ id: 1, username: 'load-teacher', email: 'load-teacher@example.com', passwordHash: 'x', role: 'teacher' }).run();
  const students = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, username: `load-student-${i}`, email: `load-${i}@example.com`, passwordHash: 'x', role: 'student' as const }));
  db.insert(schema.users).values(students).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '压力测试课程', status: 'active' }).run();
  db.insert(schema.questions).values({ id: 1, createdBy: 1, courseId: 1, type: 'single_choice', stem: '1+1=?', options: JSON.stringify(['A. 1', 'B. 2']), answerKey: JSON.stringify({ option: 'B. 2' }), defaultScore: 10, status: 'reviewed', lifecycleStatus: 'approved' }).run();
  db.insert(schema.papers).values({ id: 1, createdBy: 1, courseId: 1, title: '压力测试卷', course: '压力测试课程', totalScore: 10, status: 'ready' }).run();
  db.insert(schema.paperQuestions).values({ id: 1, paperId: 1, questionId: 1, orderNo: 1, score: 10 }).run();
  const now = Date.now();
  db.insert(schema.exams).values({ id: 1, paperId: 1, createdBy: 1, title: '压力考试', status: 'published', startAt: new Date(now - 60_000).toISOString(), endAt: new Date(now + 3_600_000).toISOString(), durationMinutes: 60 }).run();
  db.insert(schema.examAssignments).values(students.map((student, i) => ({ id: i + 1, examId: 1, studentId: student.id, dueAt: new Date(now + 3_600_000).toISOString() }))).run();
  db.insert(schema.similarQuestionJobs).values({ id: 1, requestedBy: 1, course: '压力测试课程', sourceText: 'background task', status: 'running', taskStatus: 'running' }).run();
  const app = express(); app.use(express.json()); app.use(requestIdMiddleware); app.use(authMiddleware); app.use('/api/exams', examRoutes); app.use('/api/attempts', attemptRoutes); app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokens = new Map(students.map(student => [student.id, generateToken(student.id, 'student')]));
  const timed = async (url: string, token: string, method = 'GET', body?: unknown) => {
    const started = performance.now(); const response = await fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() as any, ms: performance.now() - started };
  };
  try {
    const entered = await Promise.all(students.map(student => timed('/exams/1/start', tokens.get(student.id)!, 'POST')));
    assert.ok(entered.every(result => result.status === 201), JSON.stringify(entered.filter(result => result.status !== 201).slice(0, 3).map(result => ({ status: result.status, error: result.data?.error }))));
    const attemptIds = entered.map(result => result.data.data.attempt.id as number);
    const saved = await Promise.all(attemptIds.map((id, i) => timed(`/attempts/${id}/answers/1`, tokens.get(students[i].id)!, 'PUT', { content: 'B. 2' })));
    assert.ok(saved.every(result => result.status === 200));
    const submitStart = performance.now();
    const submitted = await Promise.all(attemptIds.flatMap((id, i) => [timed(`/attempts/${id}/submit`, tokens.get(students[i].id)!, 'POST'), timed(`/attempts/${id}/submit`, tokens.get(students[i].id)!, 'POST')]));
    const submitWallMs = performance.now() - submitStart;
    assert.ok(submitted.every(result => result.status === 200));
    const gradebook = await timed('/exams/1/results', generateToken(1, 'teacher'));
    assert.equal(gradebook.status, 200); assert.equal(db.select().from(schema.attempts).all().length, 100); assert.equal(db.select().from(schema.answers).all().length, 100);
    assert.ok(db.select().from(schema.attempts).all().every(attempt => attempt.status === 'graded' && attempt.totalScore === 10));
    process.stdout.write(`${JSON.stringify({ concurrency: 100, backgroundAiTask: 'running', enterExam: stats(entered.map(result => result.ms)), saveAnswer: stats(saved.map(result => result.ms)), duplicateSubmit: { ...stats(submitted.map(result => result.ms)), wallMs: Number(submitWallMs.toFixed(1)) }, gradebook: stats([gradebook.ms]), integrity: { attempts: 100, answers: 100, graded: 100, duplicateScores: 0, dataLoss: 0, httpErrors: 0 } }, null, 2)}\n`);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main();
