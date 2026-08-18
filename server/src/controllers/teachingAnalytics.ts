import type { NextFunction, Response } from 'express';
import { eq } from 'drizzle-orm';
import { positiveIdSchema } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessOrganization } from '../middleware/organization.js';
import { generateTeachingAnalytics, getLatestTeachingAnalytics } from '../services/teachingAnalytics.js';

function ownedCourse(req: AuthRequest) {
  const id = positiveIdSchema.parse(req.params.id); const course = db.select().from(schema.courses).where(eq(schema.courses.id, id)).get();
  if (!course) throw new AppError(404, '课程不存在');
  if (!canAccessOrganization(req, course.organizationId)) throw new AppError(403, '无权访问该组织的课程教学分析');
  if (req.userRole !== 'admin' && course.ownerUserId !== req.userId) throw new AppError(403, '无权查看该课程教学分析');
  return id;
}
export function getAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: getLatestTeachingAnalytics(ownedCourse(req), req.userId!) }); } catch (error) { next(error); }
}
export function refreshAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: generateTeachingAnalytics(ownedCourse(req), req.userId!) }); } catch (error) { next(error); }
}
