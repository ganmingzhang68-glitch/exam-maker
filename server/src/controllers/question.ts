import type { NextFunction, Response } from 'express';
import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm';
import {
  bulkQuestionActionSchema, createQuestionSchema, positiveIdSchema, questionListQuerySchema, reviewQuestionSchema,
  updateQuestionSchema,
} from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

type QuestionRow = typeof schema.questions.$inferSelect;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function serializeQuestion(
  row: QuestionRow,
  source?: { sourceFileName: string | null; sourceProjectTitle: string | null; courseName?: string | null; usageCount?: number },
) {
  return {
    ...row,
    options: parseJson<string[]>(row.options),
    answerKey: parseJson<Record<string, unknown>>(row.answerKey),
    scoringRubric: parseJson<Record<string, unknown>>(row.scoringRubric),
    knowledgePoints: parseJson<string[]>(row.knowledgePoints),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    ...(source ?? {}),
  };
}

function saveVersion(row: QuestionRow, changedBy: number, note: string): void {
  const latest = db.select({ versionNo: schema.questionVersions.versionNo }).from(schema.questionVersions)
    .where(eq(schema.questionVersions.questionId, row.id)).orderBy(desc(schema.questionVersions.versionNo)).limit(1).get();
  db.insert(schema.questionVersions).values({
    questionId: row.id, versionNo: (latest?.versionNo ?? 0) + 1,
    snapshotJson: JSON.stringify(serializeQuestion(row)), changedBy, changeNote: note,
  }).run();
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
    const file = db.select({
      id: schema.projectFiles.id,
      projectId: schema.projectFiles.projectId,
    }).from(schema.projectFiles)
      .innerJoin(schema.projects, eq(schema.projectFiles.projectId, schema.projects.id))
      .where(and(eq(schema.projectFiles.id, sourceFileId), eq(schema.projects.userId, req.userId!))).get();
    if (!file) throw new AppError(400, '来源文件不存在或无权访问');
    if (sourceProjectId && file.projectId !== sourceProjectId) {
      throw new AppError(400, '来源文件不属于所选来源项目');
    }
  }
}

export function listQuestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = questionListQuerySchema.parse(req.query);
    const conditions = [];
    if (req.userRole !== 'admin') conditions.push(eq(schema.questions.createdBy, req.userId!));
    if (query.status) conditions.push(eq(schema.questions.status, query.status));
    if (query.type) conditions.push(eq(schema.questions.type, query.type));
    if (query.difficulty) conditions.push(eq(schema.questions.difficulty, query.difficulty));
    if (query.sourceFileId) conditions.push(eq(schema.questions.sourceFileId, query.sourceFileId));
    if (query.sourceProjectId) conditions.push(eq(schema.questions.sourceProjectId, query.sourceProjectId));
    if (query.courseId) conditions.push(eq(schema.questions.courseId, query.courseId));
    if (query.origin) conditions.push(eq(schema.questions.origin, query.origin));
    if (query.lifecycleStatus) conditions.push(eq(schema.questions.lifecycleStatus, query.lifecycleStatus));
    if (query.search) conditions.push(like(schema.questions.stem, `%${query.search}%`));
    if (query.knowledgePoint) conditions.push(like(schema.questions.knowledgePoints, `%${query.knowledgePoint}%`));
    if (query.usage === 'used') conditions.push(sql`EXISTS (SELECT 1 FROM paper_questions pq WHERE pq.question_id = questions.id)`);
    if (query.usage === 'unused') conditions.push(sql`NOT EXISTS (SELECT 1 FROM paper_questions pq WHERE pq.question_id = questions.id)`);

    const order = query.sort === 'updated_asc' ? asc(schema.questions.updatedAt)
      : query.sort === 'score_desc' ? desc(schema.questions.defaultScore)
        : query.sort === 'score_asc' ? asc(schema.questions.defaultScore) : desc(schema.questions.updatedAt);

    const rows = db.select({
      question: schema.questions,
      sourceFileName: schema.projectFiles.filename,
      sourceProjectTitle: schema.projects.title,
      courseName: schema.courses.name,
      usageCount: count(schema.paperQuestions.id),
    }).from(schema.questions)
      .leftJoin(schema.projectFiles, eq(schema.questions.sourceFileId, schema.projectFiles.id))
      .leftJoin(schema.projects, eq(schema.questions.sourceProjectId, schema.projects.id))
      .leftJoin(schema.courses, eq(schema.questions.courseId, schema.courses.id))
      .leftJoin(schema.paperQuestions, eq(schema.questions.id, schema.paperQuestions.questionId))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(schema.questions.id, schema.projectFiles.filename, schema.projects.title, schema.courses.name)
      .orderBy(order)
      .limit(query.limit)
      .offset(query.offset)
      .all();
    res.json({
      success: true,
      data: rows.map((row) => serializeQuestion(row.question, {
        sourceFileName: row.sourceFileName,
        sourceProjectTitle: row.sourceProjectTitle,
        courseName: row.courseName,
        usageCount: row.usageCount,
      })),
    });
  } catch (error) { next(error); }
}

export function listQuestionSources(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conditions = req.userRole === 'admin'
      ? undefined
      : eq(schema.questions.createdBy, req.userId!);
    const rows = db.select({
      id: schema.projectFiles.id,
      projectId: schema.projectFiles.projectId,
      filename: schema.projectFiles.filename,
      projectTitle: schema.projects.title,
      questionCount: count(schema.questions.id),
    }).from(schema.questions)
      .innerJoin(schema.projectFiles, eq(schema.questions.sourceFileId, schema.projectFiles.id))
      .innerJoin(schema.projects, eq(schema.projectFiles.projectId, schema.projects.id))
      .where(conditions)
      .groupBy(
        schema.projectFiles.id,
        schema.projectFiles.projectId,
        schema.projectFiles.filename,
        schema.projects.title,
      )
      .orderBy(asc(schema.projects.title), asc(schema.projectFiles.filename))
      .all();
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
}

export function getQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const question = getOwnedQuestion(req, id);
    const source = db.select({ sourceFileName: schema.projectFiles.filename, sourceProjectTitle: schema.projects.title, courseName: schema.courses.name })
      .from(schema.questions).leftJoin(schema.projectFiles, eq(schema.questions.sourceFileId, schema.projectFiles.id))
      .leftJoin(schema.projects, eq(schema.questions.sourceProjectId, schema.projects.id))
      .leftJoin(schema.courses, eq(schema.questions.courseId, schema.courses.id)).where(eq(schema.questions.id, id)).get();
    const usedByPapers = db.select({ id: schema.papers.id, title: schema.papers.title, status: schema.papers.status })
      .from(schema.paperQuestions).innerJoin(schema.papers, eq(schema.paperQuestions.paperId, schema.papers.id))
      .where(eq(schema.paperQuestions.questionId, id)).all();
    const versions = db.select().from(schema.questionVersions).where(eq(schema.questionVersions.questionId, id))
      .orderBy(desc(schema.questionVersions.versionNo)).all().map((version) => ({
        ...version, snapshot: JSON.parse(version.snapshotJson) as Record<string, unknown>,
      }));
    const answerRows = db.select({ answer: schema.answers, paperQuestion: schema.paperQuestions })
      .from(schema.paperQuestions).innerJoin(schema.answers, eq(schema.paperQuestions.id, schema.answers.paperQuestionId))
      .where(eq(schema.paperQuestions.questionId, id)).all();
    const scored = answerRows.filter(({ answer }) => answer.finalScore !== null);
    const statistics = scored.length < 5 ? null : {
      responseCount: scored.length,
      correctRate: scored.filter(({ answer }) => answer.isCorrect === true).length / scored.length,
      averageScoreRate: scored.reduce((sum, { answer, paperQuestion }) => sum + (answer.finalScore ?? 0) / Math.max(paperQuestion.score, 1), 0) / scored.length,
    };
    res.json({ success: true, data: {
      ...serializeQuestion(question, {
        sourceFileName: source?.sourceFileName ?? null,
        sourceProjectTitle: source?.sourceProjectTitle ?? null,
        courseName: source?.courseName ?? null,
        usageCount: usedByPapers.length,
      }), versions, usedByPapers, statistics,
    } });
  } catch (error) { next(error); }
}

export function createQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createQuestionSchema.parse(req.body);
    assertSourceOwnership(req, data.sourceFileId, data.sourceProjectId);
    const row = db.insert(schema.questions).values({
      createdBy: req.userId!,
      courseId: data.courseId ?? null,
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
      origin: data.origin ?? (data.sourceFileId ? 'past_exam' : 'teacher_created'),
      lifecycleStatus: data.lifecycleStatus ?? 'draft',
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
    const existingSerialized = serializeQuestion(existing);
    createQuestionSchema.parse({
      type: data.type ?? existing.type,
      stem: data.stem ?? existing.stem,
      options: data.options === undefined ? existingSerialized.options : data.options,
      answerKey: data.answerKey === undefined ? existingSerialized.answerKey : data.answerKey,
      analysis: data.analysis === undefined ? existing.analysis : data.analysis,
      scoringRubric: data.scoringRubric === undefined ? existingSerialized.scoringRubric : data.scoringRubric,
      defaultScore: data.defaultScore ?? existing.defaultScore,
      difficulty: data.difficulty === undefined ? existing.difficulty : data.difficulty,
      knowledgePoints: data.knowledgePoints === undefined ? existingSerialized.knowledgePoints : data.knowledgePoints,
      status: data.status ?? existing.status,
      sourceFileId: data.sourceFileId === undefined ? existing.sourceFileId : data.sourceFileId,
      sourceProjectId: data.sourceProjectId === undefined ? existing.sourceProjectId : data.sourceProjectId,
      sourceQuestionNo: data.sourceQuestionNo === undefined ? existing.sourceQuestionNo : data.sourceQuestionNo,
      metadata: data.metadata === undefined ? existingSerialized.metadata : data.metadata,
    });
    assertSourceOwnership(
      req,
      data.sourceFileId === undefined ? existing.sourceFileId : data.sourceFileId,
      data.sourceProjectId === undefined ? existing.sourceProjectId : data.sourceProjectId,
    );
    saveVersion(existing, req.userId!, '教师编辑');

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

export function reviewQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const existing = getOwnedQuestion(req, id);
    const data = reviewQuestionSchema.parse(req.body);
    saveVersion(existing, req.userId!, data.status === 'reviewed' ? '审核通过' : '审核拒绝');
    const row = db.update(schema.questions).set({
      status: data.status,
      lifecycleStatus: data.status === 'reviewed' ? 'approved' : 'archived',
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.questions.id, existing.id)).returning().get();
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
    if (used) {
      const existing = getOwnedQuestion(req, id);
      saveVersion(existing, req.userId!, '题目归档');
      db.update(schema.questions).set({ lifecycleStatus: 'archived', updatedAt: new Date().toISOString() })
        .where(eq(schema.questions.id, id)).run();
      saveToDisk();
      res.json({ success: true, message: '题目已被历史试卷使用，已安全归档' });
      return;
    }
    db.delete(schema.questions).where(eq(schema.questions.id, id)).run();
    saveToDisk();
    res.json({ success: true, message: '题目已删除' });
  } catch (error) { next(error); }
}

export function copyQuestion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const source = getOwnedQuestion(req, positiveIdSchema.parse(req.params.id));
    const row = db.insert(schema.questions).values({
      ...source, id: undefined, stem: `${source.stem}（副本）`, sourceFileId: null, sourceQuestionNo: null,
      origin: 'teacher_created', aiGenerated: false, lifecycleStatus: 'draft', status: 'generated',
      createdAt: undefined, updatedAt: new Date().toISOString(),
    }).returning().get();
    saveToDisk(); res.status(201).json({ success: true, data: serializeQuestion(row) });
  } catch (error) { next(error); }
}

export function bulkQuestionAction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = bulkQuestionActionSchema.parse(req.body);
    const rows = db.select().from(schema.questions).where(inArray(schema.questions.id, data.questionIds)).all();
    if (rows.length !== data.questionIds.length || rows.some((row) => req.userRole !== 'admin' && row.createdBy !== req.userId)) throw new AppError(403, '批量操作包含无权访问的题目');
    rows.forEach((row) => saveVersion(row, req.userId!, data.action === 'archive' ? '批量归档' : '批量批准'));
    db.update(schema.questions).set({
      lifecycleStatus: data.action === 'archive' ? 'archived' : 'approved',
      status: data.action === 'archive' ? 'rejected' : 'reviewed', updatedAt: new Date().toISOString(),
    }).where(inArray(schema.questions.id, data.questionIds)).run();
    saveToDisk(); res.json({ success: true, data: { updated: rows.length } });
  } catch (error) { next(error); }
}
