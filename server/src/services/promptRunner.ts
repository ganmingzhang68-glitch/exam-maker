import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getConfig, sendMessage, type AiMessage } from './ai.js';
import { parsePromptOutput, renderPrompt, type PromptDefinition } from '../prompts/core.js';

export interface PromptTransportResult {
  text: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface PromptRunOptions {
  maxTokens?: number;
  maxRetries?: number;
  timeoutMs?: number;
  generationJobId?: number;
  similarQuestionJobId?: number;
  stageRunId?: number;
  modelParameters?: Record<string, unknown>;
  transport?: (systemPrompt: string, messages: AiMessage[], options: { maxTokens?: number }) => Promise<PromptTransportResult>;
}

export interface PromptRunResult<O> {
  promptId: string;
  promptVersion: string;
  output: O;
  attempts: number;
  aiRunId: number;
  promptVersionId: number;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorType(error: unknown, raw: string): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (raw && (!raw.trim().endsWith('}') || /finish_reason[^\n]*length/i.test(raw))) return 'truncated_output';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('429') || message.includes('rate limit')) return 'rate_limit';
  if (message.includes('401') || message.includes('403') || message.includes('api_key')) return 'authentication';
  if ((error instanceof Error && error.name === 'ZodError') || message.includes('json') || message.includes('zod') || message.includes('schema')) return 'schema_validation';
  if (message.includes('fetch') || message.includes('network')) return 'network';
  return 'unknown';
}

function isRetryable(type: string): boolean {
  return ['truncated_output', 'timeout', 'rate_limit', 'schema_validation', 'network'].includes(type);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`AI request timeout after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultTransport(systemPrompt: string, messages: AiMessage[], options: { maxTokens?: number }): Promise<PromptTransportResult> {
  return { text: await sendMessage(systemPrompt, messages, options) };
}

function persistPromptVersion<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(definition: PromptDefinition<I, O>, template: string): number {
  const templateHash = hash(template);
  const schemaHash = hash(JSON.stringify(definition.outputContract));
  db.insert(schema.promptVersions).values({
    key: definition.id, promptId: definition.id, version: definition.version,
    stage: definition.stage, pipelineStage: definition.stage, template,
    inputSchemaVersion: definition.version, outputSchemaVersion: definition.version,
    sha256: templateHash, templateHash, schemaHash, status: 'active',
  }).onConflictDoNothing().run();
  const row = db.select({ id: schema.promptVersions.id }).from(schema.promptVersions)
    .where(and(
      eq(schema.promptVersions.key, definition.id),
      eq(schema.promptVersions.version, definition.version),
    )).get();
  if (!row) throw new Error(`PromptVersion persistence failed: ${definition.id}@${definition.version}`);
  return row.id;
}

export async function runStructuredPrompt<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  definition: PromptDefinition<I, O>, input: z.input<I>, options: PromptRunOptions = {},
): Promise<PromptRunResult<z.output<O>>> {
  const rendered = renderPrompt(definition, input);
  const promptVersionId = persistPromptVersion(definition, rendered.systemPrompt);
  const transport = options.transport ?? defaultTransport;
  const config = getConfig();
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 1, 3));
  const timeoutMs = options.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS || 180000);
  const modelParameters = { maxTokens: options.maxTokens, ...options.modelParameters };
  const inputHash = hash(rendered.userPrompt);
  let previousRaw = '';
  let previousError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = new Date();
    const messages: AiMessage[] = attempt === 0
      ? [{ role: 'user', content: rendered.userPrompt }]
      : [
          { role: 'user', content: rendered.userPrompt },
          { role: 'assistant', content: previousRaw },
          { role: 'user', content: JSON.stringify({ task: 'repair_output', validation_error: previousError, rule: 'Return only one JSON object matching OUTPUT_CONTRACT. Do not add facts.' }) },
        ];
    let response: PromptTransportResult | undefined;
    try {
      response = await withTimeout(transport(rendered.systemPrompt, messages, { maxTokens: options.maxTokens }), timeoutMs);
      const output = parsePromptOutput(definition, response.text);
      const finishedAt = new Date();
      const aiRun = db.insert(schema.aiRuns).values({
        generationJobId: options.generationJobId, similarQuestionJobId: options.similarQuestionJobId,
        stageRunId: options.stageRunId, stage: definition.stage,
        promptVersionId, provider: config.provider, model: config.model,
        parameters: JSON.stringify(modelParameters), modelParameters: JSON.stringify(modelParameters), inputHash,
        outputRaw: response.text, outputParsed: JSON.stringify(output), requestId: response.requestId,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens,
        totalTokens: response.totalTokens ?? ((response.inputTokens ?? 0) + (response.outputTokens ?? 0) || undefined),
        latencyMs: finishedAt.getTime() - startedAt.getTime(), retryCount: attempt,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), status: 'succeeded',
      }).returning({ id: schema.aiRuns.id }).get();
      return { promptId: rendered.id, promptVersion: rendered.version, output, attempts: attempt + 1, aiRunId: aiRun.id, promptVersionId };
    } catch (error) {
      const finishedAt = new Date();
      previousRaw = response?.text ?? '';
      previousError = error instanceof Error ? error.message : String(error);
      const type = errorType(error, previousRaw);
      db.insert(schema.aiRuns).values({
        generationJobId: options.generationJobId, similarQuestionJobId: options.similarQuestionJobId,
        stageRunId: options.stageRunId, stage: definition.stage,
        promptVersionId, provider: config.provider, model: config.model,
        parameters: JSON.stringify(modelParameters), modelParameters: JSON.stringify(modelParameters), inputHash,
        outputRaw: previousRaw || null, requestId: response?.requestId,
        inputTokens: response?.inputTokens, outputTokens: response?.outputTokens,
        totalTokens: response?.totalTokens, latencyMs: finishedAt.getTime() - startedAt.getTime(),
        errorType: type, errorMessage: previousError, retryCount: attempt,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), status: 'failed',
      }).run();
      if (attempt >= maxRetries || !isRetryable(type)) throw error;
    }
  }
  throw new Error('unreachable');
}
