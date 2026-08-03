import type { NextFunction, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import {
  createQuestionSchema, positiveIdSchema, questionListQuerySchema, updateQuestionSchema,
} from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

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

function getOwnedQuestion(req: AuthRequest, id: number): QuestionRow {
  const question = db.select().from(schema.questions)
    .where(eq(schema.questions.id, id)).get();
  if (!question) throw new AppError(404, '题目不存在');
  if (req.userRole !== 'admin' && question.createdBy !== req.userId) {
    throw new AppError(403, '无权管理该题目');
  }
  return question;
}

function assertSourceOwnership(
  req: AuthRequest,
  sourceFileId: number | null | undefined,
  sourceProjectId: number | null | undefined
): void {
  if (req.userRole === 'admin') return;

  if (sourceProjectId) {
    const project = db.select({ id: schema.projects.id }).from(schema.projects)
      .where(and(eq(schema.projects.id, sourceProjectId), eq(schema.projects.userId, req.userId!))).get();
    if (!project) throw new AppError(400, '来源项目不存在或无权访问');
  }

  if (sourceFileId) {
    const file = db.select({ id: schema.projectFiles.id }).from(schema.projectFiles)
      .innerJoin(schema.projects, eq(schema.projectFiles.projectId, schema.projects.id))
      .where(and(eq(schema.projectFiles.id, sourceFileId), eq(schema.projects.userId, req.userId!))).get();
    if (!file) throw new AppError(400, '来源文件不存在或无权访问');
  }
}

export function listQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = questionListQuerySchema.parse(req.query);
    const conditions = [];
    if (req.userRole !== 'admin') conditions.push(eq(schema.questions.createdBy, req.userId!));
    if (query.status) conditions.push(eq(schema.questions.status, query.status));
    if (query.type) conditions.push(eq(schema.questions.type, query.type));
    if (query.sourceProjectId) conditions.push(eq(schema.questions.sourceProjectId, query.sourceProjectId));

    const rows = db.select().from(schema.questions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.questions.updatedAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    res.json({ success: true, data: rows.map(serializeQuestion) });
  } catch (error) { next(error); }
}

export function getQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    res.json({ success: true, data: serializeQuestion(getOwnedQuestion(req, id)) });
  } catch (error) { next(error); }
}

export function createQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createQuestionSchema.parse(req.body);
    assertSourceOwnership(req, data.sourceFileId, data.sourceProjectId);
    const row = db.insert(schema.questions).values({
      createdBy: req.userId!,
      sourceFileId: data.sourceFileId ?? null,
      sourceProjectId: data.sourceProjectId ?? null,
      sourceQuestionNo: data.sourceQuestionNo ?? null,
      type: data.type,
      stem: data.stem,
      options: data.options ? JSON.stringify(data.options) : null,
      answerKey: data.answerKey ? JSON.stringify(data.answerKey) : null,
      analysis: data.analysis ?? null,
      scoringRubric: data.scoringRubric ? JSON.stringify(data.scoringRubric) : null,
      defaultScore: data.defaultScore,
      difficulty: data.difficulty ?? null,
      knowledgePoints: data.knowledgePoints ? JSON.stringify(data.knowledgePoints) : null,
      status: data.status,
      aiGenerated: false,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    }).returning().get();
    saveToDisk();
    res.status(201).json({ success: true, data: serializeQuestion(row) });
  } catch (error) { next(error); }
}

export function updateQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const existing = getOwnedQuestion(req, id);
    const data = updateQuestionSchema.parse(req.body);
    assertSourceOwnership(req, data.sourceFileId, data.sourceProjectId);

    const values: Partial<typeof schema.questions.$inferInsert> = {
      ...data,
      options: data.options === undefined ? undefined : data.options === null ? null : JSON.stringify(data.options),
      answerKey: data.answerKey === undefined ? undefined : data.answerKey === null ? null : JSON.stringify(data.answerKey),
      scoringRubric: data.scoringRubric === undefined ? undefined : data.scoringRubric === null ? null : JSON.stringify(data.scoringRubric),
      knowledgePoints: data.knowledgePoints === undefined ? undefined : data.knowledgePoints === null ? null : JSON.stringify(data.knowledgePoints),
      metadata: data.metadata === undefined ? undefined : data.metadata === null ? null : JSON.stringify(data.metadata),
      updatedAt: new Date().toISOString(),
    };
    const row = db.update(schema.questions).set(values)
      .where(eq(schema.questions.id, existing.id)).returning().get();
    saveToDisk();
    res.json({ success: true, data: serializeQuestion(row) });
  } catch (error) { next(error); }
}

export function deleteQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    getOwnedQuestion(req, id);
    const used = db.select({ id: schema.paperQuestions.id }).from(schema.paperQuestions)
      .where(eq(schema.paperQuestions.questionId, id)).limit(1).get();
    if (used) throw new AppError(409, '题目已被试卷使用，不能删除');
    db.delete(schema.questions).where(eq(schema.questions.id, id)).run();
    saveToDisk();
    res.json({ success: true, message: '题目已删除' });
  } catch (error) { next(error); }
}
