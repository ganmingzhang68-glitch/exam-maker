import type { GradeReview } from '@exam-maker/shared';
import { and, desc, eq } from 'drizzle-orm';
import { db, rawDb, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { recalculateAttemptScores } from './grading.js';
import { syncStudentCourseMastery } from './knowledgeMastery.js';

function json<T>(value: string | null): T | null { if (!value) return null; try { return JSON.parse(value) as T; } catch { return null; } }
function serialize(row: typeof schema.gradeReviews.$inferSelect): GradeReview {
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, row.examId)).get();
  const student = db.select().from(schema.users).where(eq(schema.users.id, row.studentId)).get();
  const answerRow = row.answerId ? db.select({ answer: schema.answers, question: schema.paperQuestions }).from(schema.answers)
    .innerJoin(schema.paperQuestions, eq(schema.answers.paperQuestionId, schema.paperQuestions.id)).where(eq(schema.answers.id, row.answerId)).get() : null;
  const auditLogs = db.select().from(schema.gradeAuditLogs).where(eq(schema.gradeAuditLogs.gradeReviewId, row.id)).orderBy(schema.gradeAuditLogs.createdAt).all()
    .map(log => ({ ...log, before: json<Record<string, unknown>>(log.beforeJson), after: json<Record<string, unknown>>(log.afterJson) }));
  return { ...row, examTitle: exam?.title ?? '考试已不存在', studentName: student?.username ?? '学生已不存在',
    answer: answerRow ? { paperQuestionId: answerRow.answer.paperQuestionId, content: json(answerRow.answer.content), finalScore: answerRow.answer.finalScore, maxScore: answerRow.question.score } : null, auditLogs };
}

export function createGradeReview(studentId: number, input: { attemptId: number; answerId?: number | null; reason: string; evidence?: string | null }): GradeReview {
  const attempt = db.select().from(schema.attempts).where(and(eq(schema.attempts.id, input.attemptId), eq(schema.attempts.studentId, studentId))).get();
  if (!attempt) throw new AppError(404, '作答记录不存在');
  if (attempt.status !== 'graded') throw new AppError(409, '成绩尚未完成批改，暂不能申请复核');
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, attempt.examId)).get()!;
  if (!exam.gradeReviewEnabled) throw new AppError(409, '教师未开启本场考试的成绩复核');
  if (!exam.gradeReviewDeadline || new Date(exam.gradeReviewDeadline).getTime() < Date.now()) throw new AppError(409, '成绩复核申请时间已结束');
  if (input.answerId) {
    const answer = db.select().from(schema.answers).where(and(eq(schema.answers.id, input.answerId), eq(schema.answers.attemptId, attempt.id))).get();
    if (!answer) throw new AppError(400, '复核题目不属于本次作答');
  }
  const pending = db.select().from(schema.gradeReviews).where(and(eq(schema.gradeReviews.attemptId, attempt.id), eq(schema.gradeReviews.status, 'pending'))).all()
    .find(item => item.answerId === (input.answerId ?? null));
  if (pending) throw new AppError(409, '同一成绩项已有待处理复核申请');
  const now = new Date().toISOString(); const review = db.insert(schema.gradeReviews).values({ examId: exam.id, attemptId: attempt.id, answerId: input.answerId ?? null,
    studentId, reason: input.reason, evidence: input.evidence ?? null, updatedAt: now }).returning().get();
  db.insert(schema.gradeAuditLogs).values({ gradeReviewId: review.id, actorUserId: studentId, action: 'requested', afterJson: JSON.stringify({ reason: input.reason, evidence: input.evidence ?? null }), reason: input.reason }).run();
  saveToDisk(); return serialize(review);
}
export function listStudentGradeReviews(studentId: number, organizationId?: number) {
  return db.select({ review: schema.gradeReviews }).from(schema.gradeReviews)
    .innerJoin(schema.exams, eq(schema.gradeReviews.examId, schema.exams.id))
    .where(and(eq(schema.gradeReviews.studentId, studentId), organizationId ? eq(schema.exams.organizationId, organizationId) : undefined))
    .orderBy(desc(schema.gradeReviews.createdAt)).all().map(row => serialize(row.review));
}
export function listTeacherGradeReviews(teacherId: number, role: 'teacher' | 'admin', examId?: number, organizationId?: number) {
  const rows = db.select({ review: schema.gradeReviews, exam: schema.exams }).from(schema.gradeReviews).innerJoin(schema.exams, eq(schema.gradeReviews.examId, schema.exams.id))
    .where(and(examId ? eq(schema.gradeReviews.examId, examId) : undefined,
      organizationId ? eq(schema.exams.organizationId, organizationId) : undefined)).orderBy(desc(schema.gradeReviews.createdAt)).all();
  return rows.filter(row => role === 'admin' || row.exam.createdBy === teacherId).map(row => serialize(row.review));
}
export function resolveGradeReview(actorId: number, role: 'teacher' | 'admin', reviewId: number, input: { decision: 'accepted' | 'rejected'; resolution: string; adjustedScore?: number | null }): GradeReview {
  const review = db.select().from(schema.gradeReviews).where(eq(schema.gradeReviews.id, reviewId)).get(); if (!review) throw new AppError(404, '复核申请不存在');
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, review.examId)).get()!;
  if (role !== 'admin' && exam.createdBy !== actorId) throw new AppError(403, '无权处理该复核申请');
  if (review.status !== 'pending') throw new AppError(409, '该复核申请已经处理');
  let before: Record<string, unknown> = { reviewStatus: review.status }; let after: Record<string, unknown> = { reviewStatus: input.decision };
  const now = new Date().toISOString(); rawDb.run('BEGIN');
  try {
    if (input.decision === 'accepted' && input.adjustedScore !== undefined && input.adjustedScore !== null) {
      if (!review.answerId) throw new AppError(400, '整卷复核不能直接填写单题分数');
      const item = db.select({ answer: schema.answers, paperQuestion: schema.paperQuestions }).from(schema.answers)
        .innerJoin(schema.paperQuestions, eq(schema.answers.paperQuestionId, schema.paperQuestions.id)).where(eq(schema.answers.id, review.answerId)).get();
      if (!item || item.answer.attemptId !== review.attemptId) throw new AppError(409, '复核对应答案已不存在');
      if (input.adjustedScore > item.paperQuestion.score) throw new AppError(400, '调整分数不能超过题目满分');
      before = { ...before, answerId: item.answer.id, finalScore: item.answer.finalScore };
      db.update(schema.answers).set({ manualScore: input.adjustedScore, finalScore: input.adjustedScore, gradingStatus: 'manual_graded', gradedBy: actorId, gradedAt: now, updatedAt: now }).where(eq(schema.answers.id, item.answer.id)).run();
      const attempt = recalculateAttemptScores(review.attemptId); after = { ...after, answerId: item.answer.id, finalScore: input.adjustedScore, attemptTotalScore: attempt.totalScore };
    }
    const updated = db.update(schema.gradeReviews).set({ status: input.decision, resolution: input.resolution, resolvedBy: actorId, resolvedAt: now, updatedAt: now }).where(eq(schema.gradeReviews.id, review.id)).returning().get();
    db.insert(schema.gradeAuditLogs).values({ gradeReviewId: review.id, actorUserId: actorId, action: input.decision === 'accepted' ? 'accepted' : 'rejected', beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after), reason: input.resolution }).run();
    rawDb.run('COMMIT');
    const paper = db.select({ courseId: schema.papers.courseId }).from(schema.attempts).innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id)).innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id)).where(eq(schema.attempts.id, review.attemptId)).get();
    if (paper?.courseId) syncStudentCourseMastery(review.studentId, paper.courseId);
    saveToDisk(); return serialize(updated);
  } catch (error) { try { rawDb.run('ROLLBACK'); } catch { /* ignore */ } throw error; }
}
