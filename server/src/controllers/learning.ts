import type { NextFunction, Response } from 'express';
import { eq } from 'drizzle-orm';
import { positiveIdSchema } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessOrganization } from '../middleware/organization.js';
import { getStudentLearningOverview, getTeacherCourseKnowledgeAnalytics } from '../services/knowledgeMastery.js';

export function getMyLearning(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: getStudentLearningOverview(req.userId!, req.organizationId) }); }
  catch (error) { next(error); }
}

export function getCourseKnowledgeAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const courseId = positiveIdSchema.parse(req.params.id);
    const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get();
    if (!course) throw new AppError(404, '课程不存在');
    if (!canAccessOrganization(req, course.organizationId)) throw new AppError(403, '无权访问该组织的课程知识点分析');
    if (req.userRole !== 'admin' && course.ownerUserId !== req.userId) throw new AppError(403, '无权查看该课程知识点分析');
    res.json({ success: true, data: getTeacherCourseKnowledgeAnalytics(courseId) });
  } catch (error) { next(error); }
}
