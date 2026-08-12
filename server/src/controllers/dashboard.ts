import type { NextFunction, Response } from 'express';
import { and, count, desc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, saveToDisk, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getStudentExamSummaries } from '../services/examStatus.js';

function scalar(row: { value: number } | undefined): number { return Number(row?.value ?? 0); }

export function getTeacherDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerId = req.userId!;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const activeCourseCount = scalar(db.select({ value: count() }).from(schema.courses)
      .where(and(eq(schema.courses.ownerUserId, ownerId), eq(schema.courses.status, 'active'))).get());
    const activeClassCount = scalar(db.select({ value: count() }).from(schema.teachingClasses)
      .where(and(eq(schema.teachingClasses.teacherUserId, ownerId), eq(schema.teachingClasses.status, 'active'))).get());
    const ongoingExamCount = scalar(db.select({ value: count() }).from(schema.exams)
      .where(and(
        eq(schema.exams.createdBy, ownerId), eq(schema.exams.status, 'published'),
        or(isNull(schema.exams.startAt), lte(schema.exams.startAt, now.toISOString())),
        or(isNull(schema.exams.endAt), gt(schema.exams.endAt, now.toISOString())),
      )).get());
    const pendingGradingCount = scalar(db.select({ value: count() }).from(schema.attempts)
      .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
      .where(and(eq(schema.exams.createdBy, ownerId), eq(schema.attempts.status, 'grading'))).get());
    const weeklySubmissionCount = scalar(db.select({ value: count() }).from(schema.attempts)
      .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
      .where(and(eq(schema.exams.createdBy, ownerId), gte(schema.attempts.submittedAt, weekStart.toISOString()))).get());

    const examRows = db.select({ exam: schema.exams, paper: schema.papers }).from(schema.exams)
      .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
      .where(eq(schema.exams.createdBy, ownerId)).orderBy(desc(schema.exams.updatedAt)).limit(8).all();
    const recentExams = examRows.map(({ exam, paper }) => {
      const assignments = scalar(db.select({ value: count() }).from(schema.examAssignments)
        .where(eq(schema.examAssignments.examId, exam.id)).get());
      const submitted = scalar(db.select({ value: count() }).from(schema.attempts)
        .where(and(eq(schema.attempts.examId, exam.id), inArray(schema.attempts.status, ['submitted', 'grading', 'graded']))).get());
      const pending = scalar(db.select({ value: count() }).from(schema.attempts)
        .where(and(eq(schema.attempts.examId, exam.id), eq(schema.attempts.status, 'grading'))).get());
      const classes = db.select({ name: schema.teachingClasses.name }).from(schema.teachingClasses)
        .innerJoin(schema.courses, eq(schema.teachingClasses.courseId, schema.courses.id))
        .where(and(eq(schema.teachingClasses.teacherUserId, ownerId), eq(schema.courses.name, paper.course), eq(schema.teachingClasses.status, 'active'))).all();
      return {
        id: exam.id, title: exam.title, course: paper.course, classNames: classes.map((item) => item.name),
        startAt: exam.startAt, endAt: exam.endAt, status: exam.status,
        submittedCount: submitted, assignmentCount: assignments, pendingGradingCount: pending,
      };
    });
    const recentPapers = db.select({
      id: schema.papers.id, title: schema.papers.title, course: schema.papers.course,
      status: schema.papers.status, updatedAt: schema.papers.updatedAt,
    }).from(schema.papers).where(eq(schema.papers.createdBy, ownerId))
      .orderBy(desc(schema.papers.updatedAt)).limit(6).all();
    const failedProjects = db.select({ id: schema.projects.id, title: schema.projects.title })
      .from(schema.projects).where(and(eq(schema.projects.userId, ownerId), eq(schema.projects.status, 'error')))
      .orderBy(desc(schema.projects.updatedAt)).limit(5).all();
    const issues = failedProjects.map((project) => ({ type: 'generation_error', title: project.title, description: 'AI 出卷项目执行失败，需要检查日志或重试。', resourceId: project.id }));
    const activities = [
      ...db.select({ id: schema.projects.id, title: schema.projects.title, occurredAt: schema.projects.updatedAt })
        .from(schema.projects).where(eq(schema.projects.userId, ownerId)).orderBy(desc(schema.projects.updatedAt)).limit(5).all()
        .map((item) => ({ type: 'project', title: `出卷项目：${item.title}`, occurredAt: item.occurredAt, resourceId: item.id })),
      ...examRows.slice(0, 5).map(({ exam }) => ({ type: 'exam', title: `考试：${exam.title}`, occurredAt: exam.updatedAt, resourceId: exam.id })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 8);

    res.json({ success: true, data: {
      metrics: { activeCourseCount, activeClassCount, ongoingExamCount, pendingGradingCount, weeklySubmissionCount },
      recentExams, recentPapers, issues, activities,
    } });
  } catch (error) { next(error); }
}

export function getStudentDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const studentId = req.userId!;
    const result = getStudentExamSummaries(studentId);
    if (result.changed) saveToDisk();
    const courses = db.select({
      id: schema.courses.id, name: schema.courses.name, classId: schema.teachingClasses.id,
      className: schema.teachingClasses.name, semester: schema.teachingClasses.semester,
    }).from(schema.enrollments)
      .innerJoin(schema.teachingClasses, eq(schema.enrollments.classId, schema.teachingClasses.id))
      .innerJoin(schema.courses, eq(schema.teachingClasses.courseId, schema.courses.id))
      .where(and(
        eq(schema.enrollments.studentId, studentId), eq(schema.enrollments.status, 'active'),
        eq(schema.teachingClasses.status, 'active'),
      )).orderBy(schema.courses.name).all();
    const recentScores = db.select({ attempt: schema.attempts, exam: schema.exams, paper: schema.papers })
      .from(schema.attempts)
      .innerJoin(schema.exams, eq(schema.attempts.examId, schema.exams.id))
      .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
      .where(and(eq(schema.attempts.studentId, studentId), eq(schema.attempts.status, 'graded')))
      .orderBy(desc(schema.attempts.gradedAt), desc(schema.attempts.updatedAt)).limit(5).all()
      .map(({ attempt, exam, paper }) => ({
        examId: exam.id, examTitle: exam.title, attemptId: attempt.id,
        score: attempt.totalScore, totalScore: paper.totalScore, gradedAt: attempt.gradedAt ?? attempt.updatedAt,
      }));
    const statuses = result.data.map((exam) => exam.displayStatus);
    res.json({ success: true, data: {
      exams: result.data, courses,
      metrics: {
        pendingCount: statuses.filter((status) => status === 'available').length,
        inProgressCount: statuses.filter((status) => status === 'in_progress').length,
        upcomingCount: statuses.filter((status) => status === 'upcoming').length,
        completedCount: statuses.filter((status) => ['submitted', 'grading', 'graded'].includes(status)).length,
      },
      recentScores,
    } });
  } catch (error) { next(error); }
}
