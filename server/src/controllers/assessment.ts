import type { NextFunction, Response } from 'express';
import { eq } from 'drizzle-orm';
import { positiveIdSchema, reviewQuestionQualitySchema } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessOrganization } from '../middleware/organization.js';
import { buildExamAssessment } from '../services/examAssessment.js';
import { reviewQuestionQuality, syncQuestionQualityReports } from '../services/questionQualityReport.js';

function ownedExam(req: AuthRequest, id: number) {
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, id)).get();
  if (!exam) throw new AppError(404, '考试不存在');
  if (!canAccessOrganization(req, exam.organizationId)) throw new AppError(403, '无权访问该组织的考试质量分析');
  if (req.userRole !== 'admin' && exam.createdBy !== req.userId) throw new AppError(403, '无权查看该考试质量分析');
  return exam;
}

export function getExamAssessment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    ownedExam(req, id);
    const result = buildExamAssessment(id);
    if (!result) throw new AppError(409, '考试试卷数据不完整，无法分析');
    res.json({ success: true, data: syncQuestionQualityReports(result) });
  } catch (error) { next(error); }
}

export function reviewExamQuestionQuality(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const paperQuestionId = positiveIdSchema.parse(req.params.paperQuestionId);
    ownedExam(req, examId);
    const input = reviewQuestionQualitySchema.parse(req.body);
    const report = reviewQuestionQuality(examId, paperQuestionId, input.action, req.userId!);
    if (!report) throw new AppError(404, '题目质量报告不存在，请先打开考试质量分析');
    res.json({ success: true, data: report });
  } catch (error) { next(error); }
}
