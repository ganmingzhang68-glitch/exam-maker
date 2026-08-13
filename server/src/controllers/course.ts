import type { NextFunction, Response } from 'express';
import { and, count, desc, eq, like, ne, or } from 'drizzle-orm';
import {
  courseListQuerySchema,
  createCourseSchema,
  positiveIdSchema,
  updateCourseSchema,
} from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getCourseDifficultyCalibration as buildCourseDifficultyCalibration } from '../services/difficultyCalibration.js';
import { getCourseGradingCalibration as buildCourseGradingCalibration } from '../services/gradingCalibration.js';

type CourseRow = typeof schema.courses.$inferSelect;

function parseMaterialIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

function serializeCourse(row: CourseRow) {
  return { ...row, materialDocumentIds: parseMaterialIds(row.materialDocumentIds) };
}

function getOwnedCourse(req: AuthRequest, id: number): CourseRow {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, id)).get();
  if (!course) throw new AppError(404, '课程不存在');
  if (req.userRole !== 'admin' && course.ownerUserId !== req.userId) {
    throw new AppError(403, '无权访问该课程');
  }
  return course;
}

function assertUniqueName(ownerUserId: number, name: string, excludeId?: number): void {
  const conditions = [eq(schema.courses.ownerUserId, ownerUserId), eq(schema.courses.name, name)];
  if (excludeId) conditions.push(ne(schema.courses.id, excludeId));
  const duplicate = db.select({ id: schema.courses.id }).from(schema.courses)
    .where(and(...conditions)).get();
  if (duplicate) throw new AppError(409, '同名课程已存在');
}

function scalar(result: { value: number } | undefined): number {
  return Number(result?.value ?? 0);
}

function courseSummary(course: CourseRow) {
  const classCount = scalar(db.select({ value: count() }).from(schema.teachingClasses)
    .where(and(eq(schema.teachingClasses.courseId, course.id), eq(schema.teachingClasses.status, 'active'))).get());
  const materialCount = scalar(db.select({ value: count() }).from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.courseId, course.id)).get());
  const questionCount = scalar(db.select({ value: count() }).from(schema.questions)
    .innerJoin(schema.projects, eq(schema.questions.sourceProjectId, schema.projects.id))
    .where(and(
      eq(schema.projects.courseId, course.id),
      eq(schema.questions.createdBy, course.ownerUserId),
    )).get());
  const paperCondition = and(
    eq(schema.papers.createdBy, course.ownerUserId),
    eq(schema.papers.course, course.name),
  );
  const paperCount = scalar(db.select({ value: count() }).from(schema.papers)
    .where(paperCondition).get());
  const examCount = scalar(db.select({ value: count() }).from(schema.exams)
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(paperCondition).get());
  const gradedAttemptCount = scalar(db.select({ value: count() }).from(schema.attempts)
    .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(and(paperCondition, eq(schema.attempts.status, 'graded'))).get());
  return {
    classCount,
    materialCount: Math.max(materialCount, parseMaterialIds(course.materialDocumentIds).length),
    questionCount,
    paperCount,
    examCount,
    gradedAttemptCount,
  };
}

export function listCourses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = courseListQuerySchema.parse(req.query);
    const conditions = [];
    if (req.userRole !== 'admin') conditions.push(eq(schema.courses.ownerUserId, req.userId!));
    if (query.status) conditions.push(eq(schema.courses.status, query.status));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(
        like(schema.courses.name, pattern),
        like(schema.courses.code, pattern),
        like(schema.courses.semester, pattern),
      )!);
    }
    const rows = db.select().from(schema.courses)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.courses.updatedAt)).all();
    res.json({ success: true, data: rows.map((row) => ({ ...serializeCourse(row), summary: courseSummary(row) })) });
  } catch (error) { next(error); }
}

export function getCourse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const course = getOwnedCourse(req, positiveIdSchema.parse(req.params.id));
    res.json({ success: true, data: { ...serializeCourse(course), summary: courseSummary(course) } });
  } catch (error) { next(error); }
}

export function getCourseDifficultyCalibration(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedCourse(req, id);
    res.json({ success: true, data: buildCourseDifficultyCalibration(id) });
  } catch (error) { next(error); }
}

export function getCourseGradingCalibration(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedCourse(req, id);
    res.json({ success: true, data: buildCourseGradingCalibration(id) });
  } catch (error) { next(error); }
}

export function createCourse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createCourseSchema.parse(req.body);
    assertUniqueName(req.userId!, data.name);
    const owner = db.select({ username: schema.users.username }).from(schema.users)
      .where(eq(schema.users.id, req.userId!)).get();
    const now = new Date().toISOString();
    const row = db.insert(schema.courses).values({
      ownerUserId: req.userId!,
      name: data.name,
      code: data.code ?? null,
      semester: data.semester ?? null,
      description: data.description ?? null,
      instructorName: data.instructorName ?? owner?.username ?? null,
      status: data.status,
      archivedAt: data.status === 'archived' ? now : null,
      updatedAt: now,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: { ...serializeCourse(row), summary: courseSummary(row) } });
  } catch (error) { next(error); }
}

export function updateCourse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const course = getOwnedCourse(req, id);
    const data = updateCourseSchema.parse(req.body);
    if (data.name) assertUniqueName(course.ownerUserId, data.name, id);
    const now = new Date().toISOString();
    const row = db.update(schema.courses).set({
      ...data,
      archivedAt: data.status === 'archived' ? now : data.status ? null : course.archivedAt,
      updatedAt: now,
    }).where(eq(schema.courses.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: { ...serializeCourse(row), summary: courseSummary(row) } });
  } catch (error) { next(error); }
}

export function archiveCourse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedCourse(req, id);
    const now = new Date().toISOString();
    const row = db.update(schema.courses).set({
      status: 'archived', archivedAt: now, updatedAt: now,
    }).where(eq(schema.courses.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: { ...serializeCourse(row), summary: courseSummary(row) }, message: '课程已归档' });
  } catch (error) { next(error); }
}
