import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export function startGenerationStage(generationJobId: number, stage: string, input: unknown, inputArtifactIds: number[] = []) {
  const last = db.select({ attemptNo: schema.generationJobStages.attemptNo }).from(schema.generationJobStages)
    .where(and(eq(schema.generationJobStages.generationJobId, generationJobId), eq(schema.generationJobStages.stage, stage)))
    .orderBy(desc(schema.generationJobStages.attemptNo)).get();
  const now = new Date().toISOString();
  const run = db.insert(schema.generationJobStages).values({
    generationJobId, stage, attemptNo: (last?.attemptNo ?? 0) + 1,
    inputJson: JSON.stringify(input), inputArtifactIds: JSON.stringify(inputArtifactIds),
    status: 'running', startedAt: now, updatedAt: now,
  }).returning().get();
  db.update(schema.generationJobs).set({ currentStage: stage, status: 'running', taskStatus: 'running', errorSummary: null, updatedAt: now })
    .where(eq(schema.generationJobs.id, generationJobId)).run();
  return run;
}

export function finishGenerationStage(stageRunId: number, output: unknown, outputArtifactIds: number[] = []) {
  const now = new Date().toISOString();
  const run = db.update(schema.generationJobStages).set({
    outputJson: JSON.stringify(output), outputArtifactIds: JSON.stringify(outputArtifactIds),
    status: 'succeeded', finishedAt: now, updatedAt: now,
  }).where(eq(schema.generationJobStages.id, stageRunId)).returning().get();
  if (!run) throw new Error(`GenerationStageRun ${stageRunId} not found`);
  db.update(schema.generationJobs).set({ lastSuccessfulStage: run.stage, currentStage: null, status: 'pending', taskStatus: 'queued', updatedAt: now })
    .where(eq(schema.generationJobs.id, run.generationJobId)).run();
  return run;
}

export function failGenerationStage(stageRunId: number, error: unknown, retryable: boolean) {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const run = db.update(schema.generationJobStages).set({
    errorMessage: message, errorStack: stack, retryable, status: 'failed', finishedAt: now, updatedAt: now,
  }).where(eq(schema.generationJobStages.id, stageRunId)).returning().get();
  if (!run) throw new Error(`GenerationStageRun ${stageRunId} not found`);
  db.update(schema.generationJobs).set({ currentStage: run.stage, errorSummary: message, status: 'failed', taskStatus: 'failed', finishedAt: now, updatedAt: now })
    .where(eq(schema.generationJobs.id, run.generationJobId)).run();
  return run;
}

export function getGenerationJobChain(generationJobId: number) {
  return {
    job: db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, generationJobId)).get() ?? null,
    stages: db.select().from(schema.generationJobStages).where(eq(schema.generationJobStages.generationJobId, generationJobId))
      .orderBy(asc(schema.generationJobStages.id)).all(),
    aiRuns: db.select().from(schema.aiRuns).where(eq(schema.aiRuns.generationJobId, generationJobId))
      .orderBy(asc(schema.aiRuns.id)).all(),
  };
}

export function getResumePoint(generationJobId: number): { lastSuccessfulStage: string | null; failedStage: string | null } {
  const chain = getGenerationJobChain(generationJobId);
  const failed = [...chain.stages].reverse().find((stage) => stage.status === 'failed');
  return { lastSuccessfulStage: chain.job?.lastSuccessfulStage ?? null, failedStage: failed?.stage ?? null };
}

export function getAiRunMetrics(generationJobId: number) {
  const runs = getGenerationJobChain(generationJobId).aiRuns;
  const successful = runs.filter((run) => run.status === 'succeeded');
  const firstPass = successful.filter((run) => run.retryCount === 0).length;
  const repaired = successful.filter((run) => run.retryCount > 0).length;
  return {
    calls: successful.length,
    attempts: runs.length,
    firstPassSchemaRate: successful.length ? firstPass / successful.length : null,
    repairedSchemaRate: successful.length ? repaired / successful.length : null,
    averageRetryCount: successful.length ? successful.reduce((sum, run) => sum + run.retryCount, 0) / successful.length : null,
    inputTokens: runs.reduce((sum, run) => sum + (run.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + (run.outputTokens ?? 0), 0),
    totalTokens: runs.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0),
    averageLatencyMs: runs.length ? runs.reduce((sum, run) => sum + (run.latencyMs ?? 0), 0) / runs.length : null,
  };
}
