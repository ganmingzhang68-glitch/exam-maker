import type { NextFunction, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import {
  createExamSchema,
  positiveIdSchema,
  updateExamSchema,
} from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { canAccessOrganization } from '../middleware/organization.js';
import {
  buildPaperSnapshot,
  ensurePaperQuestionSnapshots,
  getAttemptDetail,
} from '../services/attemptSnapshot.js';
import { getStudentExamSummaries, settleExpiredAttempts } from '../services/examStatus.js';

type ExamRow = typeof schema.exams.$inferSelect;

function getOwnedExam(req: AuthRequest, id: number): ExamRow {
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, id)).get();
  if (!exam) throw new AppError(404, '考试不存在');
  if (!canAccessOrganization(req, exam.organizationId)) throw new AppError(403, '无权访问该组织的考试');
  if (req.userRole !== 'admin' && exam.createdBy !== req.userId) {
    throw new AppError(403, '无权管理该考试');
  }
  return exam;
}

function getOwnedPaper(req: AuthRequest, id: number) {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, id)).get();
  if (!paper) throw new AppError(404, '试卷不存在');
  if (req.userRole !== 'admin' && paper.createdBy !== req.userId) {
    throw new AppError(403, '无权使用该试卷');
  }
  const question = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions)
    .where(eq(schema.paperQuestions.paperId, id)).limit(1).get();
  if (!question) throw new AppError(409, '试卷没有题目，不能创建考试');
  return paper;
}

function teacherExamSummary(exam: ExamRow) {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, exam.paperId)).get();
  const assignments = db.select({ id: schema.examAssignments.id }).from(schema.examAssignments)
    .where(eq(schema.examAssignments.examId, exam.id)).all();
  const attempts = db.select({ id: schema.attempts.id }).from(schema.attempts)
    .where(eq(schema.attempts.examId, exam.id)).all();
  return {
    ...exam,
    paperTitle: paper?.title ?? '试卷已不存在',
    paperTotalScore: paper?.totalScore ?? 0,
    assignmentCount: assignments.length,
    attemptCount: attempts.length,
  };
}

export function listTeacherExams(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conditions = [];
    if (req.userRole !== 'admin') conditions.push(eq(schema.exams.createdBy, req.userId!));
    if (req.organizationExplicit) conditions.push(eq(schema.exams.organizationId, req.organizationId!));
    const rows = db.select().from(schema.exams)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.exams.updatedAt)).all();
    res.json({ success: true, data: rows.map(teacherExamSummary) });
  } catch (error) { next(error); }
}

export function getTeacherExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    res.json({ success: true, data: teacherExamSummary(getOwnedExam(req, id)) });
  } catch (error) { next(error); }
}

export function createExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createExamSchema.parse(req.body);
    getOwnedPaper(req, data.paperId);
    const row = db.insert(schema.exams).values({
      paperId: data.paperId,
      organizationId: getOwnedPaper(req, data.paperId).organizationId,
      createdBy: req.userId!,
      title: data.title,
      status: 'draft',
      startAt: data.startAt,
      endAt: data.endAt,
      durationMinutes: data.durationMinutes,
      allowedAttempts: data.allowedAttempts,
      fillBlankIgnoreCase: data.fillBlankIgnoreCase,
      showAnswers: data.showAnswers,
      showAnalysis: data.showAnalysis,
      gradeReviewEnabled: data.gradeReviewEnabled,
      gradeReviewDeadline: data.gradeReviewDeadline ?? null,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: teacherExamSummary(row) });
  } catch (error) { next(error); }
}

export function updateExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const exam = getOwnedExam(req, id);
    if (exam.status !== 'draft') throw new AppError(409, '只有考试草稿可以编辑');
    const changes = updateExamSchema.parse(req.body);
    const merged = createExamSchema.parse({
      paperId: changes.paperId ?? exam.paperId,
      title: changes.title ?? exam.title,
      startAt: changes.startAt ?? exam.startAt,
      endAt: changes.endAt ?? exam.endAt,
      durationMinutes: changes.durationMinutes ?? exam.durationMinutes,
      allowedAttempts: changes.allowedAttempts ?? exam.allowedAttempts,
      fillBlankIgnoreCase: changes.fillBlankIgnoreCase ?? exam.fillBlankIgnoreCase,
      showAnswers: changes.showAnswers ?? exam.showAnswers,
      showAnalysis: changes.showAnalysis ?? exam.showAnalysis,
      gradeReviewEnabled: changes.gradeReviewEnabled ?? exam.gradeReviewEnabled,
      gradeReviewDeadline: changes.gradeReviewDeadline === undefined ? exam.gradeReviewDeadline : changes.gradeReviewDeadline,
    });
    getOwnedPaper(req, merged.paperId);
    const row = db.update(schema.exams).set({
      ...changes,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.exams.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: teacherExamSummary(row) });
  } catch (error) { next(error); }
}

export function publishExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const exam = getOwnedExam(req, id);
    if (exam.status === 'published') {
      res.json({ success: true, data: teacherExamSummary(exam) });
      return;
    }
    if (exam.status === 'closed') throw new AppError(409, '已关闭考试不能重新发布');
    createExamSchema.parse(exam);
    if (!exam.endAt || new Date(exam.endAt).getTime() <= Date.now()) {
      throw new AppError(409, '考试结束时间必须晚于当前时间');
    }
    getOwnedPaper(req, exam.paperId);
    ensurePaperQuestionSnapshots(exam.paperId);
    buildPaperSnapshot(exam.paperId);

    const students = db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.role, 'student')).all();
    for (const student of students) {
      const existing = db.select({ id: schema.examAssignments.id }).from(schema.examAssignments).where(and(
        eq(schema.examAssignments.examId, exam.id),
        eq(schema.examAssignments.studentId, student.id),
      )).get();
      if (!existing) {
        db.insert(schema.examAssignments).values({
          examId: exam.id,
          studentId: student.id,
          dueAt: exam.endAt,
        }).run();
      }
    }
    const now = new Date().toISOString();
    const row = db.update(schema.exams).set({
      status: 'published',
      publishedAt: now,
      updatedAt: now,
    }).where(eq(schema.exams.id, exam.id)).returning().get();
    db.update(schema.papers).set({ status: 'ready', updatedAt: now })
      .where(eq(schema.papers.id, exam.paperId)).run();
    saveToDisk();
    res.json({ success: true, data: teacherExamSummary(row) });
  } catch (error) { next(error); }
}

export function closeExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const exam = getOwnedExam(req, id);
    if (exam.status === 'closed') {
      res.json({ success: true, data: teacherExamSummary(exam) });
      return;
    }
    if (exam.status !== 'published') throw new AppError(409, '只有已发布考试可以关闭');
    const row = db.update(schema.exams).set({
      status: 'closed',
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.exams.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: teacherExamSummary(row) });
  } catch (error) { next(error); }
}

export function listStudentExams(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = getStudentExamSummaries(req.userId!);
    if (result.changed) saveToDisk();
    res.json({ success: true, data: result.data });
  } catch (error) { next(error); }
}

export function startExam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, examId)).get();
    if (!exam || exam.status !== 'published') throw new AppError(404, '考试不存在或未发布');
    const assignment = db.select().from(schema.examAssignments).where(and(
      eq(schema.examAssignments.examId, examId),
      eq(schema.examAssignments.studentId, req.userId!),
    )).get();
    if (!assignment) throw new AppError(403, '未被分配参加该考试');
    const now = new Date();
    if (exam.startAt && now.getTime() < new Date(exam.startAt).getTime()) {
      throw new AppError(403, '考试尚未开始');
    }
    if (exam.endAt && now.getTime() >= new Date(exam.endAt).getTime()) {
      throw new AppError(403, '考试已经结束');
    }
    let attempts = db.select().from(schema.attempts).where(and(
      eq(schema.attempts.examId, examId),
      eq(schema.attempts.studentId, req.userId!),
    )).orderBy(desc(schema.attempts.attemptNo)).all();
    if (settleExpiredAttempts(exam, attempts, now.getTime())) {
      saveToDisk();
      attempts = db.select().from(schema.attempts).where(and(
        eq(schema.attempts.examId, examId),
        eq(schema.attempts.studentId, req.userId!),
      )).orderBy(desc(schema.attempts.attemptNo)).all();
    }
    const active = attempts.find((attempt) => attempt.status === 'in_progress');
    if (active) {
      res.json({ success: true, data: getAttemptDetail(active.id) });
      return;
    }
    if (attempts.length >= exam.allowedAttempts) {
      throw new AppError(409, '已达到允许作答次数');
    }
    const snapshot = buildPaperSnapshot(exam.paperId);
    const durationEnd = now.getTime() + exam.durationMinutes * 60_000;
    const examEnd = exam.endAt ? new Date(exam.endAt).getTime() : durationEnd;
    const expiresAt = new Date(Math.min(durationEnd, examEnd)).toISOString();
    const row = db.insert(schema.attempts).values({
      examId,
      assignmentId: assignment.id,
      studentId: req.userId!,
      attemptNo: attempts.length + 1,
      status: 'in_progress',
      paperSnapshot: JSON.stringify(snapshot),
      startedAt: now.toISOString(),
      expiresAt,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: getAttemptDetail(row.id) });
  } catch (error) { next(error); }
}

export function getStudentExamQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const examId = positiveIdSchema.parse(req.params.id);
    const exam = db.select().from(schema.exams).where(eq(schema.exams.id, examId)).get();
    if (!exam) throw new AppError(404, '考试不存在');
    let attempt = db.select().from(schema.attempts).where(and(
      eq(schema.attempts.examId, examId),
      eq(schema.attempts.studentId, req.userId!),
      eq(schema.attempts.status, 'in_progress'),
    )).orderBy(desc(schema.attempts.attemptNo)).get();
    if (!attempt) throw new AppError(409, '请先开始考试');
    if (settleExpiredAttempts(exam, [attempt])) {
      saveToDisk();
      attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, attempt.id)).get();
      if (!attempt || attempt.status !== 'in_progress') throw new AppError(409, '作答时间已结束，试卷已自动提交');
    }
    const detail = getAttemptDetail(attempt.id);
    res.json({
      success: true,
      data: {
        exam: detail.exam,
        attemptId: attempt.id,
        questions: detail.questions,
      },
    });
  } catch (error) { next(error); }
}
