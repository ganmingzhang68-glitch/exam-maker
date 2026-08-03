import type { NextFunction, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { positiveIdSchema } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function studentQuestion(row: {
  paperQuestion: typeof schema.paperQuestions.$inferSelect;
  question: typeof schema.questions.$inferSelect;
}) {
  const snapshot = parseJson<Record<string, unknown>>(row.paperQuestion.questionSnapshot);
  const source = snapshot ?? {
    id: row.question.id,
    type: row.question.type,
    stem: row.question.stem,
    options: parseJson<string[]>(row.question.options),
  };
  const { answerKey: _answerKey, analysis: _analysis, scoringRubric: _rubric, ...safe } = source;
  return {
    paperQuestionId: row.paperQuestion.id,
    orderNo: row.paperQuestion.orderNo,
    sectionTitle: row.paperQuestion.sectionTitle,
    score: row.paperQuestion.score,
    ...safe,
  };
}

export function getStudentExamQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, examId)).get();
    if (!exam || exam.status !== 'published') throw new AppError(404, '考试不存在或未发布');

    const assignment = db.select().from(schema.examAssignments).where(and(
      eq(schema.examAssignments.examId, examId),
      eq(schema.examAssignments.studentId, req.userId!),
    )).get();
    if (!assignment) throw new AppError(403, '未被分配参加该考试');

    const now = new Date().toISOString();
    if (exam.startAt && now < exam.startAt) throw new AppError(403, '考试尚未开始');
    if (exam.endAt && now > exam.endAt) throw new AppError(403, '考试已结束');

    const rows = db.select({
      paperQuestion: schema.paperQuestions,
      question: schema.questions,
    }).from(schema.paperQuestions)
      .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
      .where(eq(schema.paperQuestions.paperId, exam.paperId))
      .orderBy(schema.paperQuestions.orderNo)
      .all();

    res.json({
      success: true,
      data: {
        exam: { id: exam.id, title: exam.title, durationMinutes: exam.durationMinutes, endAt: exam.endAt },
        questions: rows.map(studentQuestion),
      },
    });
  } catch (error) { next(error); }
}
