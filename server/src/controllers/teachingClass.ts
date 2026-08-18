import type { NextFunction, Response } from 'express';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import {
  addEnrollmentsSchema,
  createTeachingClassSchema,
  importEnrollmentsSchema,
  positiveIdSchema,
  studentSearchQuerySchema,
  teachingClassListQuerySchema,
  updateTeachingClassSchema,
} from '@exam-maker/shared';
import { db, rawDb, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { canAccessOrganization } from '../middleware/organization.js';

type ClassRow = typeof schema.teachingClasses.$inferSelect;

function getOwnedCourse(req: AuthRequest, courseId: number) {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, courseId)).get();
  if (!course) throw new AppError(404, '课程不存在');
  if (!canAccessOrganization(req, course.organizationId)) throw new AppError(403, '无权访问该组织的课程');
  if (req.userRole !== 'admin' && course.ownerUserId !== req.userId) throw new AppError(403, '无权管理该课程');
  return course;
}

function getOwnedClass(req: AuthRequest, classId: number): ClassRow {
  const row = db.select().from(schema.teachingClasses).where(eq(schema.teachingClasses.id, classId)).get();
  if (!row) throw new AppError(404, '班级不存在');
  if (!canAccessOrganization(req, row.organizationId)) throw new AppError(403, '无权访问该组织的班级');
  if (req.userRole !== 'admin' && row.teacherUserId !== req.userId) throw new AppError(403, '无权管理该班级');
  return row;
}

function scalar(row: { value: number } | undefined): number { return Number(row?.value ?? 0); }

function serializeClass(row: ClassRow) {
  const course = db.select({ name: schema.courses.name }).from(schema.courses)
    .where(eq(schema.courses.id, row.courseId)).get();
  const studentCount = scalar(db.select({ value: count() }).from(schema.enrollments)
    .where(and(eq(schema.enrollments.classId, row.id), eq(schema.enrollments.status, 'active'))).get());
  return { ...row, courseName: course?.name ?? '未知课程', studentCount };
}

function assertUniqueClassName(courseId: number, name: string, excludeId?: number): void {
  const rows = db.select({ id: schema.teachingClasses.id }).from(schema.teachingClasses)
    .where(and(eq(schema.teachingClasses.courseId, courseId), eq(schema.teachingClasses.name, name))).all();
  if (rows.some((row) => row.id !== excludeId)) throw new AppError(409, '该课程下已存在同名班级');
}

function studentExamCounts(studentId: number, classRow: ClassRow) {
  const course = db.select({ name: schema.courses.name }).from(schema.courses)
    .where(eq(schema.courses.id, classRow.courseId)).get();
  if (!course) return { examCount: 0, completedExamCount: 0 };
  const baseCondition = and(
    eq(schema.examAssignments.studentId, studentId),
    eq(schema.exams.createdBy, classRow.teacherUserId),
    eq(schema.papers.course, course.name),
  );
  const examCount = scalar(db.select({ value: count() }).from(schema.examAssignments)
    .innerJoin(schema.exams, eq(schema.examAssignments.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(baseCondition).get());
  const completedExamCount = scalar(db.select({ value: count() }).from(schema.attempts)
    .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(and(
      eq(schema.attempts.studentId, studentId),
      eq(schema.exams.createdBy, classRow.teacherUserId),
      eq(schema.papers.course, course.name),
      or(eq(schema.attempts.status, 'submitted'), eq(schema.attempts.status, 'grading'), eq(schema.attempts.status, 'graded')),
    )).get());
  return { examCount, completedExamCount };
}

function classDetail(row: ClassRow) {
  const members = db.select({ enrollment: schema.enrollments, user: schema.users })
    .from(schema.enrollments)
    .innerJoin(schema.users, eq(schema.enrollments.studentId, schema.users.id))
    .where(eq(schema.enrollments.classId, row.id))
    .orderBy(schema.enrollments.status, schema.users.username).all();
  return {
    ...serializeClass(row),
    students: members.map(({ enrollment, user }) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      enrollmentId: enrollment.id,
      enrollmentStatus: enrollment.status,
      joinedAt: enrollment.joinedAt,
      removedAt: enrollment.removedAt,
      ...studentExamCounts(user.id, row),
    })),
  };
}

export function listTeachingClasses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = teachingClassListQuerySchema.parse(req.query);
    const conditions = [];
    if (req.organizationId && (req.userRole !== 'admin' || req.organizationExplicit)) conditions.push(eq(schema.teachingClasses.organizationId, req.organizationId));
    if (req.userRole !== 'admin') conditions.push(eq(schema.teachingClasses.teacherUserId, req.userId!));
    if (query.courseId) conditions.push(eq(schema.teachingClasses.courseId, query.courseId));
    if (query.status) conditions.push(eq(schema.teachingClasses.status, query.status));
    if (query.search) conditions.push(like(schema.teachingClasses.name, `%${query.search}%`));
    const rows = db.select().from(schema.teachingClasses)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.teachingClasses.updatedAt)).all();
    res.json({ success: true, data: rows.map(serializeClass) });
  } catch (error) { next(error); }
}

export function createTeachingClass(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createTeachingClassSchema.parse(req.body);
    const course = getOwnedCourse(req, data.courseId);
    if (course.status === 'archived') throw new AppError(409, '已归档课程不能创建班级');
    assertUniqueClassName(data.courseId, data.name);
    const now = new Date().toISOString();
    const row = db.insert(schema.teachingClasses).values({
      courseId: data.courseId,
      organizationId: course.organizationId,
      teacherUserId: req.userId!,
      name: data.name,
      semester: data.semester ?? course.semester,
      status: data.status,
      archivedAt: data.status === 'archived' ? now : null,
      updatedAt: now,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: classDetail(row) });
  } catch (error) { next(error); }
}

export function getTeachingClass(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const row = getOwnedClass(req, positiveIdSchema.parse(req.params.id));
    res.json({ success: true, data: classDetail(row) });
  } catch (error) { next(error); }
}

export function updateTeachingClass(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const current = getOwnedClass(req, id);
    const data = updateTeachingClassSchema.parse(req.body);
    if (data.name) assertUniqueClassName(current.courseId, data.name, id);
    const now = new Date().toISOString();
    const row = db.update(schema.teachingClasses).set({
      ...data,
      archivedAt: data.status === 'archived' ? now : data.status ? null : current.archivedAt,
      updatedAt: now,
    }).where(eq(schema.teachingClasses.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: classDetail(row) });
  } catch (error) { next(error); }
}

export function archiveTeachingClass(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedClass(req, id);
    const now = new Date().toISOString();
    const row = db.update(schema.teachingClasses).set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(eq(schema.teachingClasses.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: classDetail(row), message: '班级已归档' });
  } catch (error) { next(error); }
}

export function searchStudents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const classId = positiveIdSchema.parse(req.params.id);
    const classRow = getOwnedClass(req, classId);
    const query = studentSearchQuerySchema.parse(req.query);
    const conditions = [eq(schema.users.role, 'student')];
    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(or(like(schema.users.username, pattern), like(schema.users.email, pattern))!);
    }
    const students = db.selectDistinct({ id: schema.users.id, username: schema.users.username, email: schema.users.email })
      .from(schema.users).innerJoin(schema.userOrganizations, eq(schema.userOrganizations.userId, schema.users.id))
      .where(and(...conditions, eq(schema.userOrganizations.organizationId, classRow.organizationId)))
      .orderBy(schema.users.username).limit(query.limit).all();
    const enrollmentRows = db.select().from(schema.enrollments).where(eq(schema.enrollments.classId, classId)).all();
    const statusByStudent = new Map(enrollmentRows.map((row) => [row.studentId, row.status]));
    res.json({ success: true, data: students.map((student) => ({ ...student, enrollmentStatus: statusByStudent.get(student.id) ?? null })) });
  } catch (error) { next(error); }
}

function addStudents(classRow: ClassRow, studentIds: number[]) {
  const users = db.selectDistinct({ id: schema.users.id }).from(schema.users)
    .innerJoin(schema.userOrganizations, eq(schema.userOrganizations.userId, schema.users.id))
    .where(and(eq(schema.users.role, 'student'), eq(schema.users.isActive, true),
      eq(schema.userOrganizations.organizationId, classRow.organizationId))).all();
  const students = new Set(users.map((user) => user.id));
  if (studentIds.some((id) => !students.has(id))) throw new AppError(400, '学生列表包含不存在或非学生账号');
  const existing = db.select().from(schema.enrollments).where(eq(schema.enrollments.classId, classRow.id)).all();
  const byStudent = new Map(existing.map((row) => [row.studentId, row]));
  const result = { added: [] as number[], restored: [] as number[], alreadyActive: [] as number[] };
  const now = new Date().toISOString();
  rawDb.run('BEGIN');
  try {
    for (const studentId of studentIds) {
      const enrollment = byStudent.get(studentId);
      if (!enrollment) {
        db.insert(schema.enrollments).values({ classId: classRow.id, studentId, status: 'active', joinedAt: now, updatedAt: now }).run();
        result.added.push(studentId);
      } else if (enrollment.status === 'removed') {
        db.update(schema.enrollments).set({ status: 'active', joinedAt: now, removedAt: null, updatedAt: now })
          .where(eq(schema.enrollments.id, enrollment.id)).run();
        result.restored.push(studentId);
      } else result.alreadyActive.push(studentId);
    }
    rawDb.run('COMMIT');
  } catch (error) {
    try { rawDb.run('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw error;
  }
  saveToDisk();
  return result;
}

export function addEnrollments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const classRow = getOwnedClass(req, positiveIdSchema.parse(req.params.id));
    if (classRow.status === 'archived') throw new AppError(409, '已归档班级不能添加学生');
    const data = addEnrollmentsSchema.parse(req.body);
    res.status(201).json({ success: true, data: { ...addStudents(classRow, data.studentIds), missing: [] } });
  } catch (error) { next(error); }
}

export function importEnrollments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const classRow = getOwnedClass(req, positiveIdSchema.parse(req.params.id));
    if (classRow.status === 'archived') throw new AppError(409, '已归档班级不能导入学生');
    const data = importEnrollmentsSchema.parse(req.body);
    const allStudents = db.selectDistinct({ id: schema.users.id, username: schema.users.username, email: schema.users.email })
      .from(schema.users).innerJoin(schema.userOrganizations, eq(schema.userOrganizations.userId, schema.users.id))
      .where(and(eq(schema.users.role, 'student'), eq(schema.users.isActive, true),
        eq(schema.userOrganizations.organizationId, classRow.organizationId))).all();
    const lookup = new Map<string, number>();
    allStudents.forEach((student) => { lookup.set(student.username.toLowerCase(), student.id); lookup.set(student.email.toLowerCase(), student.id); });
    const matched = new Set<number>();
    const missing: string[] = [];
    data.studentIdentifiers.forEach((identifier) => {
      const id = lookup.get(identifier.toLowerCase());
      if (id) matched.add(id); else missing.push(identifier);
    });
    const result = matched.size ? addStudents(classRow, [...matched]) : { added: [], restored: [], alreadyActive: [] };
    res.status(201).json({ success: true, data: { ...result, missing } });
  } catch (error) { next(error); }
}

export function removeEnrollment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const classId = positiveIdSchema.parse(req.params.id);
    const studentId = positiveIdSchema.parse(req.params.studentId);
    getOwnedClass(req, classId);
    const enrollment = db.select().from(schema.enrollments).where(and(
      eq(schema.enrollments.classId, classId), eq(schema.enrollments.studentId, studentId),
    )).get();
    if (!enrollment || enrollment.status !== 'active') throw new AppError(404, '有效的班级成员不存在');
    const now = new Date().toISOString();
    db.update(schema.enrollments).set({ status: 'removed', removedAt: now, updatedAt: now })
      .where(eq(schema.enrollments.id, enrollment.id)).run();
    saveToDisk();
    res.json({ success: true, message: '学生已移出班级' });
  } catch (error) { next(error); }
}
