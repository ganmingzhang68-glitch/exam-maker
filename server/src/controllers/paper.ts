import type { NextFunction, Response } from 'express';
import { and, desc, eq, isNotNull, like, or } from 'drizzle-orm';
import {
  addPaperQuestionSchema,
  createPaperSchema,
  paperListQuerySchema,
  positiveIdSchema,
  reorderPaperQuestionsSchema,
  updatePaperQuestionSchema,
  updatePaperSchema,
} from '@exam-maker/shared';
import { db, rawDb, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

type PaperRow = typeof schema.papers.$inferSelect;
type QuestionRow = typeof schema.questions.$inferSelect;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function serializeQuestion(row: QuestionRow) {
  return {
    ...row,
    options: parseJson<string[]>(row.options),
    answerKey: parseJson<Record<string, unknown>>(row.answerKey),
    scoringRubric: parseJson<Record<string, unknown>>(row.scoringRubric),
    knowledgePoints: parseJson<string[]>(row.knowledgePoints),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
  };
}

function questionSnapshot(row: QuestionRow): string {
  return JSON.stringify(serializeQuestion(row));
}

function getOwnedPaper(req: AuthRequest, id: number): PaperRow {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, id)).get();
  if (!paper) throw new AppError(404, '试卷不存在');
  if (req.userRole !== 'admin' && paper.createdBy !== req.userId) {
    throw new AppError(403, '无权管理该试卷');
  }
  return paper;
}

function assertSourceProjectOwnership(req: AuthRequest, sourceProjectId: number | null | undefined): void {
  if (!sourceProjectId || req.userRole === 'admin') return;
  const project = db.select({ id: schema.projects.id }).from(schema.projects).where(and(
    eq(schema.projects.id, sourceProjectId),
    eq(schema.projects.userId, req.userId!),
  )).get();
  if (!project) throw new AppError(400, '来源项目不存在或无权访问');
}

function assertPaperMutable(paper: PaperRow): void {
  const lockedExam = db.select({ id: schema.exams.id }).from(schema.exams).where(and(
    eq(schema.exams.paperId, paper.id),
    or(
      eq(schema.exams.status, 'published'),
      eq(schema.exams.status, 'closed'),
      isNotNull(schema.exams.publishedAt),
    ),
  )).limit(1).get();
  if (lockedExam) throw new AppError(409, '该试卷已用于发布考试，不能直接修改');
}

function recalculateTotal(paperId: number): number {
  const rows = db.select({ score: schema.paperQuestions.score }).from(schema.paperQuestions)
    .where(eq(schema.paperQuestions.paperId, paperId)).all();
  const totalScore = rows.reduce((sum, row) => sum + row.score, 0);
  db.update(schema.papers).set({
    totalScore,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.papers.id, paperId)).run();
  return totalScore;
}

function resequenceQuestions(paperId: number): void {
  const rows = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions)
    .where(eq(schema.paperQuestions.paperId, paperId))
    .orderBy(schema.paperQuestions.orderNo)
    .all();
  if (rows.length === 0) return;
  rawDb.run('BEGIN');
  try {
    rawDb.run('UPDATE paper_questions SET order_no = order_no + 1000000 WHERE paper_id = ?', [paperId]);
    rows.forEach((row, index) => {
      rawDb.run('UPDATE paper_questions SET order_no = ? WHERE id = ?', [index + 1, row.id]);
    });
    rawDb.run('COMMIT');
  } catch (error) {
    try { rawDb.run('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw error;
  }
}

function getPaperDetail(paperId: number) {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, paperId)).get();
  if (!paper) throw new AppError(404, '试卷不存在');
  const rows = db.select({
    paperQuestion: schema.paperQuestions,
    question: schema.questions,
  }).from(schema.paperQuestions)
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.paperId, paperId))
    .orderBy(schema.paperQuestions.orderNo)
    .all();
  return {
    ...paper,
    questions: rows.map((row) => ({
      ...row.paperQuestion,
      questionSnapshot: parseJson<Record<string, unknown>>(row.paperQuestion.questionSnapshot),
      question: serializeQuestion(row.question),
    })),
  };
}

function paperSummary(paper: PaperRow) {
  const questions = db.select({ difficulty: schema.questions.difficulty }).from(schema.paperQuestions)
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.paperId, paper.id)).all();
  const usageCount = db.select({ id: schema.exams.id }).from(schema.exams).where(eq(schema.exams.paperId, paper.id)).all().length;
  const weights = questions.map((item) => item.difficulty === 'hard' ? 3 : item.difficulty === 'medium' ? 2 : 1);
  const average = weights.length ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 0;
  const estimatedDifficulty = average ? average >= 2.5 ? 'hard' : average >= 1.5 ? 'medium' : 'basic' : null;
  return { ...paper, questionCount: questions.length, usageCount, estimatedDifficulty, displayStatus: usageCount ? 'used' : paper.status };
}

function assertCourseOwnership(req: AuthRequest, courseId: number | null | undefined): void {
  if (!courseId || req.userRole === 'admin') return;
  const course = db.select().from(schema.courses).where(and(eq(schema.courses.id, courseId), eq(schema.courses.ownerUserId, req.userId!))).get();
  if (!course) throw new AppError(400, '课程不存在或无权访问');
}

export function listPapers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = paperListQuerySchema.parse(req.query);
    const conditions = [];
    if (req.userRole !== 'admin') conditions.push(eq(schema.papers.createdBy, req.userId!));
    if (query.status) conditions.push(eq(schema.papers.status, query.status));
    if (query.courseId) conditions.push(eq(schema.papers.courseId, query.courseId));
    if (query.search) conditions.push(like(schema.papers.title, `%${query.search}%`));
    const rows = db.select().from(schema.papers)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.papers.updatedAt))
      .all();
    res.json({ success: true, data: rows.map(paperSummary) });
  } catch (error) { next(error); }
}

export function getPaper(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedPaper(req, id);
    res.json({ success: true, data: getPaperDetail(id) });
  } catch (error) { next(error); }
}

export function createPaper(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createPaperSchema.parse(req.body);
    assertSourceProjectOwnership(req, data.sourceProjectId);
    assertCourseOwnership(req, data.courseId);
    const row = db.insert(schema.papers).values({
      createdBy: req.userId!,
      courseId: data.courseId ?? null,
      sourceProjectId: data.sourceProjectId ?? null,
      title: data.title,
      course: data.course,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      durationMinutes: data.durationMinutes,
      totalScore: 0,
      status: data.status,
      creationMethod: data.creationMethod,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: { ...row, questions: [] } });
  } catch (error) { next(error); }
}

export function updatePaper(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const paper = getOwnedPaper(req, id);
    assertPaperMutable(paper);
    const data = updatePaperSchema.parse(req.body);
    assertSourceProjectOwnership(req, data.sourceProjectId);
    assertCourseOwnership(req, data.courseId);
    const row = db.update(schema.papers).set({
      ...data,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.papers.id, id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: row });
  } catch (error) { next(error); }
}

export function deletePaper(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedPaper(req, id);
    db.update(schema.papers).set({ status: 'archived', updatedAt: new Date().toISOString() })
      .where(eq(schema.papers.id, id)).run();
    saveToDisk();
    res.json({ success: true, message: '试卷已归档' });
  } catch (error) { next(error); }
}

export function copyPaper(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const source = getOwnedPaper(req, positiveIdSchema.parse(req.params.id));
    const now = new Date().toISOString();
    const row = db.insert(schema.papers).values({
      createdBy: req.userId!, courseId: source.courseId, sourceProjectId: null,
      title: `${source.title}（副本）`, course: source.course, description: source.description,
      instructions: source.instructions, durationMinutes: source.durationMinutes,
      totalScore: source.totalScore, status: 'draft', creationMethod: 'manual', updatedAt: now,
    }).returning().get();
    const questions = db.select().from(schema.paperQuestions).where(eq(schema.paperQuestions.paperId, source.id)).orderBy(schema.paperQuestions.orderNo).all();
    questions.forEach((item) => db.insert(schema.paperQuestions).values({
      paperId: row.id, questionId: item.questionId, sectionTitle: item.sectionTitle,
      orderNo: item.orderNo, score: item.score, questionSnapshot: item.questionSnapshot,
    }).run());
    saveToDisk(); res.status(201).json({ success: true, data: getPaperDetail(row.id) });
  } catch (error) { next(error); }
}

export function addPaperQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const paperId = positiveIdSchema.parse(req.params.id);
    const paper = getOwnedPaper(req, paperId);
    assertPaperMutable(paper);
    const data = addPaperQuestionSchema.parse(req.body);
    const question = db.select().from(schema.questions)
      .where(eq(schema.questions.id, data.questionId)).get();
    if (!question) throw new AppError(404, '题目不存在');
    if (req.userRole !== 'admin' && question.createdBy !== req.userId) {
      throw new AppError(403, '无权使用该题目');
    }
    if (question.status !== 'reviewed') {
      throw new AppError(409, '仅已审核题目可以加入试卷');
    }
    const duplicate = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions).where(and(
      eq(schema.paperQuestions.paperId, paperId),
      eq(schema.paperQuestions.questionId, question.id),
    )).get();
    if (duplicate) throw new AppError(409, '该题目已在试卷中');
    const existing = db.select({ orderNo: schema.paperQuestions.orderNo }).from(schema.paperQuestions)
      .where(eq(schema.paperQuestions.paperId, paperId))
      .orderBy(desc(schema.paperQuestions.orderNo)).limit(1).get();
    db.insert(schema.paperQuestions).values({
      paperId,
      questionId: question.id,
      sectionTitle: data.sectionTitle ?? null,
      orderNo: (existing?.orderNo ?? 0) + 1,
      score: data.score ?? question.defaultScore,
      questionSnapshot: questionSnapshot(question),
    }).run();
    recalculateTotal(paperId);
    saveToDisk();
    res.status(201).json({ success: true, data: getPaperDetail(paperId) });
  } catch (error) { next(error); }
}

export function updatePaperQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const paperId = positiveIdSchema.parse(req.params.id);
    const paperQuestionId = positiveIdSchema.parse(req.params.paperQuestionId);
    const paper = getOwnedPaper(req, paperId);
    assertPaperMutable(paper);
    const existing = db.select().from(schema.paperQuestions).where(and(
      eq(schema.paperQuestions.id, paperQuestionId),
      eq(schema.paperQuestions.paperId, paperId),
    )).get();
    if (!existing) throw new AppError(404, '试卷题目不存在');
    const data = updatePaperQuestionSchema.parse(req.body);
    db.update(schema.paperQuestions).set(data)
      .where(eq(schema.paperQuestions.id, paperQuestionId)).run();
    recalculateTotal(paperId);
    saveToDisk();
    res.json({ success: true, data: getPaperDetail(paperId) });
  } catch (error) { next(error); }
}

export function removePaperQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const paperId = positiveIdSchema.parse(req.params.id);
    const paperQuestionId = positiveIdSchema.parse(req.params.paperQuestionId);
    const paper = getOwnedPaper(req, paperId);
    assertPaperMutable(paper);
    const existing = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions).where(and(
      eq(schema.paperQuestions.id, paperQuestionId),
      eq(schema.paperQuestions.paperId, paperId),
    )).get();
    if (!existing) throw new AppError(404, '试卷题目不存在');
    db.delete(schema.paperQuestions).where(eq(schema.paperQuestions.id, paperQuestionId)).run();
    resequenceQuestions(paperId);
    recalculateTotal(paperId);
    saveToDisk();
    res.json({ success: true, data: getPaperDetail(paperId) });
  } catch (error) { next(error); }
}

export function reorderPaperQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const paperId = positiveIdSchema.parse(req.params.id);
    const paper = getOwnedPaper(req, paperId);
    assertPaperMutable(paper);
    const data = reorderPaperQuestionsSchema.parse(req.body);
    const current = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions)
      .where(eq(schema.paperQuestions.paperId, paperId)).all();
    const currentIds = current.map((item) => item.id).sort((a, b) => a - b);
    const requestedIds = [...data.paperQuestionIds].sort((a, b) => a - b);
    if (currentIds.length !== requestedIds.length ||
        currentIds.some((id, index) => id !== requestedIds[index])) {
      throw new AppError(400, '排序列表必须完整包含试卷中的所有题目');
    }
    if (current.length > 0) {
      rawDb.run('BEGIN');
      try {
        rawDb.run('UPDATE paper_questions SET order_no = order_no + 1000000 WHERE paper_id = ?', [paperId]);
        data.paperQuestionIds.forEach((id, index) => {
          rawDb.run('UPDATE paper_questions SET order_no = ? WHERE id = ? AND paper_id = ?', [index + 1, id, paperId]);
        });
        rawDb.run('COMMIT');
      } catch (error) {
        try { rawDb.run('ROLLBACK'); } catch { /* ignore rollback failure */ }
        throw error;
      }
    }
    db.update(schema.papers).set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.papers.id, paperId)).run();
    saveToDisk();
    res.json({ success: true, data: getPaperDetail(paperId) });
  } catch (error) { next(error); }
}
