import type { NextFunction, Response } from 'express';
import { eq } from 'drizzle-orm';
import { positiveIdSchema } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { buildExamAssessment } from '../services/examAssessment.js';

export function getExamAssessment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, id)).get();
    if (!exam) throw new AppError(404, '考试不存在');
    if (req.userRole !== 'admin' && exam.createdBy !== req.userId) throw new AppError(403, '无权查看该考试质量分析');
    const result = buildExamAssessment(id);
    if (!result) throw new AppError(409, '考试试卷数据不完整，无法分析');
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}
