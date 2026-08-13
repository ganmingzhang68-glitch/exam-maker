import { and, asc, desc, eq } from 'drizzle-orm';
import type { TaskDetail, TaskKind, TaskStageAttempt, TaskStatus, TaskSummary } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';

const generationStageOrder = [
  'document_extraction', 'exam_structure_parsing', 'question_answer_alignment', 'question_normalization',
  'knowledge_taxonomy_building', 'question_classification', 'exam_template_extraction',
  'historical_blueprint_generation', 'target_blueprint_creation', 'paper_generation_planning',
  'question_generation', 'answer_and_rubric_generation', 'paper_validation', 'paper_export',
];
const legacyGenerationStageOrder = [
  'document_extraction', 'historical_blueprint_generation', 'exam_template_extraction',
  'paper_generation_planning', 'question_generation', 'paper_export',
];
const similarStageOrder = [
  'question_parsing', 'taxonomy_generation', 'classification', 'question_generation',
  'answer_and_rubric_generation', 'independent_validation',
];

type GenerationJob = typeof schema.generationJobs.$inferSelect;
type SimilarJob = typeof schema.similarQuestionJobs.$inferSelect;

function durationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const parse = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value);
  const value = parse(end) - parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizedStatus(taskStatus: string | null, legacyStatus: string): TaskStatus {
  if (taskStatus && ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled', 'blocked'].includes(taskStatus)) {
    return taskStatus as TaskStatus;
  }
  if (legacyStatus === 'pending') return 'queued';
  if (legacyStatus === 'running') return 'running';
  if (legacyStatus === 'succeeded' || legacyStatus === 'saved') return 'succeeded';
  if (legacyStatus === 'failed') return 'failed';
  return 'blocked';
}

function latestCompleted(attempts: TaskStageAttempt[]): number {
  return new Set(attempts.filter(item => item.status === 'succeeded').map(item => item.stage)).size;
}

function aiMetrics(kind: TaskKind, id: number) {
  const runs = kind === 'generation'
    ? db.select().from(schema.aiRuns).where(eq(schema.aiRuns.generationJobId, id)).all()
    : db.select().from(schema.aiRuns).where(eq(schema.aiRuns.similarQuestionJobId, id)).all();
  const models = [...new Set(runs.map(run => run.model).filter(Boolean))];
  return {
    model: models.length ? models.join(', ') : null,
    inputTokens: runs.reduce((sum, run) => sum + (run.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + (run.outputTokens ?? 0), 0),
  };
}

function generationAttempts(id: number): TaskStageAttempt[] {
  return db.select().from(schema.generationJobStages)
    .where(eq(schema.generationJobStages.generationJobId, id)).orderBy(asc(schema.generationJobStages.id)).all()
    .map(row => ({ id: row.id, stage: row.stage, attemptNumber: row.attemptNo, status: row.status,
      retryable: row.retryable, startedAt: row.startedAt, finishedAt: row.finishedAt,
      durationMs: durationMs(row.startedAt, row.finishedAt), error: row.errorMessage }));
}

function similarAttempts(id: number): TaskStageAttempt[] {
  return db.select().from(schema.similarQuestionJobStages)
    .where(eq(schema.similarQuestionJobStages.jobId, id)).orderBy(asc(schema.similarQuestionJobStages.id)).all()
    .map(row => ({ id: row.id, stage: row.stage, attemptNumber: row.attemptNo, status: row.status,
      retryable: row.retryable, startedAt: row.startedAt, finishedAt: row.finishedAt,
      durationMs: durationMs(row.startedAt, row.finishedAt), error: row.errorMessage }));
}

function serializeGeneration(row: GenerationJob): TaskDetail {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, row.projectId)).get();
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, row.courseId)).get();
  const attempts = generationAttempts(row.id);
  const ai = aiMetrics('generation', row.id);
  const status = normalizedStatus(row.taskStatus, row.status);
  const totalStages = row.pipelineVersion.startsWith('legacy-project-workflow')
    ? legacyGenerationStageOrder.length : generationStageOrder.length;
  return { key: `generation:${row.id}`, id: row.id, kind: 'generation', name: project?.title ?? `试卷生成 #${row.id}`,
    course: course?.name ?? project?.course ?? null, status, currentStage: row.currentStage,
    completedStages: latestCompleted(attempts), totalStages,
    createdAt: row.createdAt, updatedAt: row.updatedAt, finishedAt: row.finishedAt,
    durationMs: durationMs(row.createdAt, row.finishedAt ?? (status === 'running' ? new Date().toISOString() : row.updatedAt)),
    error: row.errorSummary, requestId: row.requestId, ...ai, estimatedCost: null,
    resultPath: `/projects/${row.projectId}`, attempts, costNote: '未配置版本化模型价格，成本不做猜测。' };
}

function serializeSimilar(row: SimilarJob): TaskDetail {
  const attempts = similarAttempts(row.id);
  const ai = aiMetrics('similar_question', row.id);
  const status = normalizedStatus(row.taskStatus, row.status);
  return { key: `similar_question:${row.id}`, id: row.id, kind: 'similar_question', name: `${row.course} · 快速仿题`,
    course: row.course, status, currentStage: row.currentStage,
    completedStages: latestCompleted(attempts), totalStages: similarStageOrder.length,
    createdAt: row.createdAt, updatedAt: row.updatedAt, finishedAt: row.finishedAt,
    durationMs: durationMs(row.createdAt, row.finishedAt ?? (status === 'running' ? new Date().toISOString() : row.updatedAt)),
    error: row.errorSummary, requestId: row.requestId, ...ai, estimatedCost: null,
    resultPath: `/questions/generate?jobId=${row.id}`, attempts, costNote: '未配置版本化模型价格，成本不做猜测。' };
}

export function listTasks(userId: number, isAdmin: boolean): TaskSummary[] {
  const generations = isAdmin ? db.select().from(schema.generationJobs).all()
    : db.select().from(schema.generationJobs).where(eq(schema.generationJobs.requestedBy, userId)).all();
  const similar = isAdmin ? db.select().from(schema.similarQuestionJobs).all()
    : db.select().from(schema.similarQuestionJobs).where(eq(schema.similarQuestionJobs.requestedBy, userId)).all();
  return [...generations.map(serializeGeneration), ...similar.map(serializeSimilar)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(kind: TaskKind, id: number, userId: number, isAdmin: boolean): TaskDetail | null {
  if (kind === 'generation') {
    const row = db.select().from(schema.generationJobs).where(isAdmin
      ? eq(schema.generationJobs.id, id)
      : and(eq(schema.generationJobs.id, id), eq(schema.generationJobs.requestedBy, userId))).get();
    return row ? serializeGeneration(row) : null;
  }
  const row = db.select().from(schema.similarQuestionJobs).where(isAdmin
    ? eq(schema.similarQuestionJobs.id, id)
    : and(eq(schema.similarQuestionJobs.id, id), eq(schema.similarQuestionJobs.requestedBy, userId))).get();
  return row ? serializeSimilar(row) : null;
}
