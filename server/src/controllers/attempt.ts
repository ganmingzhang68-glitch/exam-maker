import type { NextFunction, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { positiveIdSchema, saveAnswerSchema } from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getAttemptDetail, parsePaperSnapshot } from '../services/attemptSnapshot.js';
import { gradeAttempt } from '../services/grading.js';
import { settleExpiredAttempts } from '../services/examStatus.js';

function getStudentAttempt(req: AuthRequest, id: number) {
  const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, id)).get();
  if (!attempt) throw new AppError(404, '作答记录不存在');
  if (attempt.studentId !== req.userId) throw new AppError(403, '无权访问该作答记录');
  return attempt;
}

function serializeAnswer(row: typeof schema.answers.$inferSelect) {
  let content: unknown = null;
  try { content = row.content ? JSON.parse(row.content) : null; } catch { content = null; }
  return { ...row, content };
}

export function getAttempt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const attempt = getStudentAttempt(req, id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, attempt.examId)).get();
    if (exam && settleExpiredAttempts(exam, [attempt])) saveToDisk();
    res.json({ success: true, data: getAttemptDetail(id) });
  } catch (error) { next(error); }
}

export function saveAttemptAnswer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const attemptId = positiveIdSchema.parse(req.params.id);
    const paperQuestionId = positiveIdSchema.parse(req.params.paperQuestionId);
    const attempt = getStudentAttempt(req, attemptId);
    if (attempt.status !== 'in_progress') throw new AppError(409, '试卷已提交，不能继续修改答案');
    if (attempt.expiresAt && Date.now() >= new Date(attempt.expiresAt).getTime()) {
      throw new AppError(409, '作答时间已结束，不能继续修改答案');
    }
    const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
    if (!snapshot?.questions.some((question) => question.paperQuestionId === paperQuestionId)) {
      throw new AppError(400, '题目不属于本次作答');
    }
    const data = saveAnswerSchema.parse(req.body);
    const now = new Date().toISOString();
    const content = data.content === null ? null : JSON.stringify(data.content);
    const existing = db.select().from(schema.answers).where(and(
      eq(schema.answers.attemptId, attemptId),
      eq(schema.answers.paperQuestionId, paperQuestionId),
    )).get();
    const row = existing
      ? db.update(schema.answers).set({ content, savedAt: now, updatedAt: now })
        .where(eq(schema.answers.id, existing.id)).returning().get()
      : db.insert(schema.answers).values({
        attemptId,
        paperQuestionId,
        content,
        savedAt: now,
      }).returning().get();
    saveToDisk();
    res.json({ success: true, data: serializeAnswer(row) });
  } catch (error) { next(error); }
}

export function submitAttempt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const attempt = getStudentAttempt(req, id);
    if (['grading', 'graded'].includes(attempt.status)) {
      res.json({ success: true, data: { ...getAttemptDetail(id), idempotent: true } });
      return;
    }
    if (!['in_progress', 'submitted'].includes(attempt.status)) throw new AppError(409, '当前作答状态不能提交');
    const wasAlreadySubmitted = attempt.status === 'submitted';
    gradeAttempt(id);
    saveToDisk();
    res.json({ success: true, data: { ...getAttemptDetail(id), idempotent: wasAlreadySubmitted } });
  } catch (error) { next(error); }
}
