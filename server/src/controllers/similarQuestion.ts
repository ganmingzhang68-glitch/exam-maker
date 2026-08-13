import type { NextFunction, Response } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  createSimilarQuestionJobSchema,
  positiveIdSchema,
  saveSimilarQuestionJobSchema,
  similarQuestionJobQuerySchema,
  type SimilarQuestionResultItem,
} from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { retrySimilarQuestionJob, runSimilarQuestionJob } from '../services/similarQuestionPipeline.js';

type JobRow = typeof schema.similarQuestionJobs.$inferSelect;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function getOwnedJob(req: AuthRequest, id: number): JobRow {
  const job = db.select().from(schema.similarQuestionJobs)
    .where(eq(schema.similarQuestionJobs.id, id)).get();
  if (!job) throw new AppError(404, '快速仿题任务不存在');
  if (req.userRole !== 'admin' && job.requestedBy !== req.userId) {
    throw new AppError(403, '无权访问该快速仿题任务');
  }
  return job;
}

function serializeJob(row: JobRow, includeSource = true) {
  const stages = db.select({
    id: schema.similarQuestionJobStages.id,
    stage: schema.similarQuestionJobStages.stage,
    attemptNo: schema.similarQuestionJobStages.attemptNo,
    status: schema.similarQuestionJobStages.status,
    errorMessage: schema.similarQuestionJobStages.errorMessage,
    retryable: schema.similarQuestionJobStages.retryable,
    startedAt: schema.similarQuestionJobStages.startedAt,
    finishedAt: schema.similarQuestionJobStages.finishedAt,
  }).from(schema.similarQuestionJobStages)
    .where(eq(schema.similarQuestionJobStages.jobId, row.id))
    .orderBy(asc(schema.similarQuestionJobStages.id)).all();

  return {
    id: row.id,
    course: row.course,
    scope: row.scope,
    sourceText: includeSource ? row.sourceText : '',
    sourceAnswer: includeSource ? row.sourceAnswer : null,
    variantsPerQuestion: row.variantsPerQuestion,
    defaultScore: row.defaultScore,
    difficultyMode: row.difficultyMode,
    status: row.status,
    taskStatus: row.taskStatus ?? (row.status === 'pending' ? 'queued' : row.status === 'saved' ? 'succeeded' : row.status),
    requestId: row.requestId,
    currentStage: row.currentStage,
    lastSuccessfulStage: row.lastSuccessfulStage,
    errorSummary: row.errorSummary,
    result: parseJson(row.resultJson),
    stages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function blockText(blocks: Array<Record<string, unknown>>): string {
  return blocks.map((block) => String(block.content ?? block.markdown ?? block.latex ?? block.code ?? '')).filter(Boolean).join('\n');
}

function difficultyLevel(item: SimilarQuestionResultItem): 'basic' | 'medium' | 'hard' | null {
  const value = item.difficulty.difficultyLevel;
  return value === 'basic' || value === 'medium' || value === 'hard' ? value : null;
}

export function createSimilarQuestionJob(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = createSimilarQuestionJobSchema.parse(req.body);
    const idempotencyKey = req.header('Idempotency-Key')?.trim() || null;
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new AppError(400, 'Idempotency-Key 必须为 8-128 位字母、数字或 ._:-');
    }
    if (idempotencyKey) {
      const existing = db.select().from(schema.similarQuestionJobs).where(and(
        eq(schema.similarQuestionJobs.requestedBy, req.userId!),
        eq(schema.similarQuestionJobs.idempotencyKey, idempotencyKey),
      )).get();
      if (existing) return res.status(existing.taskStatus === 'succeeded' ? 200 : 202)
        .json({ success: true, data: serializeJob(existing) });
    }
    const now = new Date().toISOString();
    const row = db.insert(schema.similarQuestionJobs).values({
      requestedBy: req.userId!,
      course: input.course,
      scope: input.scope || null,
      sourceText: input.sourceText,
      sourceAnswer: input.sourceAnswer || null,
      variantsPerQuestion: input.variantsPerQuestion,
      defaultScore: input.defaultScore,
      difficultyMode: input.difficultyMode,
      status: 'pending',
      taskStatus: 'queued',
      requestId: req.requestId ?? null,
      idempotencyKey,
      updatedAt: now,
    }).returning().get();
    saveToDisk();
    setTimeout(() => { void runSimilarQuestionJob(row.id); }, 0);
    res.status(202).json({ success: true, data: serializeJob(row) });
  } catch (error) { next(error); }
}

export function listSimilarQuestionJobs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = similarQuestionJobQuerySchema.parse(req.query);
    const condition = req.userRole === 'admin'
      ? undefined
      : eq(schema.similarQuestionJobs.requestedBy, req.userId!);
    const rows = db.select().from(schema.similarQuestionJobs).where(condition)
      .orderBy(desc(schema.similarQuestionJobs.updatedAt))
      .limit(query.limit).offset(query.offset).all();
    res.json({ success: true, data: rows.map(row => serializeJob(row, false)) });
  } catch (error) { next(error); }
}

export function getSimilarQuestionJob(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    res.json({ success: true, data: serializeJob(getOwnedJob(req, id)) });
  } catch (error) { next(error); }
}

export function retrySimilarQuestionJobController(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const job = getOwnedJob(req, id);
    if (job.status !== 'failed') throw new AppError(409, '只有失败任务可以重试');
    retrySimilarQuestionJob(id);
    const updated = db.select().from(schema.similarQuestionJobs)
      .where(eq(schema.similarQuestionJobs.id, id)).get()!;
    res.status(202).json({ success: true, data: serializeJob(updated) });
  } catch (error) { next(error); }
}

export function saveSimilarQuestionResults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = positiveIdSchema.parse(req.params.id);
    const job = getOwnedJob(req, id);
    if (job.status !== 'succeeded' && job.status !== 'saved') {
      throw new AppError(409, '任务尚未成功完成，不能保存题目');
    }
    const input = saveSimilarQuestionJobSchema.parse(req.body);
    const result = parseJson<{ sourceQuestions: Array<Record<string, unknown>>; items: SimilarQuestionResultItem[] }>(job.resultJson);
    if (!result) throw new AppError(409, '任务结果缺失或损坏');

    const selectedIds = [...new Set(input.questionIds)];
    const selected = result.items.filter(item => selectedIds.includes(item.generatedQuestionId));
    if (selected.length !== selectedIds.length) throw new AppError(400, '包含不属于该任务的题目 ID');
    const generatedRows = db.select().from(schema.generatedQuestions)
      .where(and(
        eq(schema.generatedQuestions.similarQuestionJobId, id),
        inArray(schema.generatedQuestions.id, selectedIds),
      )).all();
    if (generatedRows.length !== selectedIds.length || generatedRows.some(row => row.status !== 'generated')) {
      throw new AppError(409, '存在尚未通过质量校验的题目');
    }

    const now = new Date().toISOString();
    for (const item of selected) {
      const existing = generatedRows.find(row => row.id === item.generatedQuestionId);
      let legacyQuestionId = existing?.legacyQuestionId ?? null;
      if (!legacyQuestionId) {
        const options = item.options.length > 0
          ? item.options.map(option => `${option.id}. ${blockText(option.content as Array<Record<string, unknown>>)}`)
          : null;
        const inserted = db.insert(schema.questions).values({
          createdBy: job.requestedBy,
          sourceQuestionNo: item.sourceQuestionNo,
          type: item.questionType,
          stem: blockText(item.stem as Array<Record<string, unknown>>),
          options: options ? JSON.stringify(options) : null,
          answerKey: JSON.stringify(item.answer),
          analysis: item.explanation.join('\n'),
          scoringRubric: JSON.stringify(item.rubric),
          defaultScore: item.score,
          difficulty: difficultyLevel(item),
          knowledgePoints: JSON.stringify(item.knowledgePoints),
          status: 'generated',
          aiGenerated: true,
          metadata: JSON.stringify({
            similarQuestionJobId: id,
            generatedQuestionId: item.generatedQuestionId,
            originality: item.originality,
            validation: item.validation,
          }),
          updatedAt: now,
        }).returning({ id: schema.questions.id }).get();
        legacyQuestionId = inserted.id;
        db.update(schema.generatedQuestions).set({ legacyQuestionId, updatedAt: now })
          .where(eq(schema.generatedQuestions.id, item.generatedQuestionId)).run();
      }
      item.savedQuestionId = legacyQuestionId;
    }

    db.update(schema.similarQuestionJobs).set({
      status: 'saved', resultJson: JSON.stringify(result), updatedAt: now,
    }).where(eq(schema.similarQuestionJobs.id, id)).run();
    saveToDisk();
    const updated = db.select().from(schema.similarQuestionJobs)
      .where(eq(schema.similarQuestionJobs.id, id)).get()!;
    res.json({ success: true, data: serializeJob(updated) });
  } catch (error) { next(error); }
}
