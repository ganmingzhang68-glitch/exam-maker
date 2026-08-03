import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Response } from 'express';
import { requireRole, type AuthRequest } from '../src/middleware/auth.js';

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as Response;
  return { response, state };
}

test('teacher-only middleware rejects students and accepts teachers', () => {
  const middleware = requireRole('teacher');
  const studentResult = responseRecorder();
  let studentNext = false;
  middleware(
    { userId: 2, userRole: 'student' } as AuthRequest,
    studentResult.response,
    (() => { studentNext = true; }) as NextFunction,
  );
  assert.equal(studentNext, false);
  assert.equal(studentResult.state.status, 403);

  const teacherResult = responseRecorder();
  let teacherNext = false;
  middleware(
    { userId: 1, userRole: 'teacher' } as AuthRequest,
    teacherResult.response,
    (() => { teacherNext = true; }) as NextFunction,
  );
  assert.equal(teacherNext, true);
  assert.equal(teacherResult.state.status, undefined);
});
