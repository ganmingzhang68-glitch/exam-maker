import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { db, saveToDisk, schema } from '../db/index.js';
import { getConfig, isConfigured } from './ai.js';
import { runStructuredPrompt } from './promptRunner.js';
import { questionParsingPrompt } from '../prompts/questionParsingPrompt.js';
import { taxonomyGenerationPrompt } from '../prompts/taxonomyGenerationPrompt.js';
import { classificationPrompt } from '../prompts/classificationPrompt.js';
import { questionGenerationPrompt } from '../prompts/questionGenerationPrompt.js';
import { answerGenerationPrompt } from '../prompts/answerGenerationPrompt.js';
import { rubricGenerationPrompt } from '../prompts/rubricGenerationPrompt.js';
import { independentValidationPrompt } from '../prompts/independentValidationPrompt.js';
import { questionSimilarity } from './similarityValidator.js';

type SimilarJob = typeof schema.similarQuestionJobs.$inferSelect;
type ParsedOutput = z.output<typeof questionParsingPrompt.outputSchema>;
type TaxonomyOutput = z.output<typeof taxonomyGenerationPrompt.outputSchema>;
type ClassificationOutput = z.output<typeof classificationPrompt.outputSchema>;
type GeneratedOutput = z.output<typeof questionGenerationPrompt.outputSchema>;
type AnswerOutput = z.output<typeof answerGenerationPrompt.outputSchema>;
type RubricOutput = z.output<typeof rubricGenerationPrompt.outputSchema>;

interface GeneratedDraft {
  sourceQuestionNo: string;
  sourceStem: string;
  knowledgePointNames: string[];
  variationAxis: string;
  similarity: number;
  question: GeneratedOutput;
  questionAiRunId: number;
  questionPromptVersionId: number;
}

interface AnsweredDraft extends GeneratedDraft {
  answer: AnswerOutput;
  rubric: RubricOutput;
  generatedQuestionId: number;
}

const activeJobs = new Set<number>();
class JobCancelledError extends Error {}
const variationAxes = [
  '正向设问改为逆向推断', '改变任务类型（计算、解释、判断或设计）', '改变信息表征方式',
  '具体实例与抽象条件互换', '加入或移除参数讨论', '与相邻考点综合', '更换真实情境或材料', '改变提问粒度并形成递进小问',
];

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function beginStage(jobId: number, stage: string, input: unknown) {
  const last = db.select({ attemptNo: schema.similarQuestionJobStages.attemptNo })
    .from(schema.similarQuestionJobStages)
    .where(and(eq(schema.similarQuestionJobStages.jobId, jobId), eq(schema.similarQuestionJobStages.stage, stage)))
    .orderBy(desc(schema.similarQuestionJobStages.attemptNo)).get();
  const now = new Date().toISOString();
  const run = db.insert(schema.similarQuestionJobStages).values({
    jobId, stage, attemptNo: (last?.attemptNo ?? 0) + 1, inputJson: JSON.stringify(input),
    status: 'running', startedAt: now, updatedAt: now,
  }).returning().get();
  db.update(schema.similarQuestionJobs).set({ status: 'running', taskStatus: 'running', currentStage: stage, errorSummary: null, updatedAt: now })
    .where(eq(schema.similarQuestionJobs.id, jobId)).run();
  saveToDisk();
  return run;
}

function finishStage(stageRunId: number, output: unknown) {
  const now = new Date().toISOString();
  const run = db.update(schema.similarQuestionJobStages).set({
    outputJson: JSON.stringify(output), status: 'succeeded', finishedAt: now, updatedAt: now,
  }).where(eq(schema.similarQuestionJobStages.id, stageRunId)).returning().get();
  if (!run) throw new Error(`快速仿题阶段 ${stageRunId} 不存在`);
  db.update(schema.similarQuestionJobs).set({ lastSuccessfulStage: run.stage, currentStage: null, updatedAt: now })
    .where(eq(schema.similarQuestionJobs.id, run.jobId)).run();
  saveToDisk();
}

function failStage(stageRunId: number, error: unknown) {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;
  const run = db.update(schema.similarQuestionJobStages).set({
    errorMessage: message, errorStack: stack, retryable: true, status: 'failed', finishedAt: now, updatedAt: now,
  }).where(eq(schema.similarQuestionJobStages.id, stageRunId)).returning().get();
  if (run) db.update(schema.similarQuestionJobs).set({ status: 'failed', currentStage: run.stage, errorSummary: message, updatedAt: now })
    .where(eq(schema.similarQuestionJobs.id, run.jobId)).run();
  saveToDisk();
}

function cachedStage<T>(jobId: number, stage: string): T | null {
  const row = db.select().from(schema.similarQuestionJobStages)
    .where(and(
      eq(schema.similarQuestionJobStages.jobId, jobId),
      eq(schema.similarQuestionJobStages.stage, stage),
      eq(schema.similarQuestionJobStages.status, 'succeeded'),
    )).orderBy(desc(schema.similarQuestionJobStages.attemptNo)).get();
  return parseJson<T>(row?.outputJson ?? null);
}

async function executeStage<T>(jobId: number, stage: string, input: unknown, work: () => Promise<T>): Promise<T> {
  const state = db.select({ taskStatus: schema.similarQuestionJobs.taskStatus }).from(schema.similarQuestionJobs)
    .where(eq(schema.similarQuestionJobs.id, jobId)).get();
  if (state?.taskStatus === 'cancelled') throw new JobCancelledError('任务已由用户取消');
  const cached = cachedStage<T>(jobId, stage);
  if (cached !== null) return cached;
  const run = beginStage(jobId, stage, input);
  try {
    const output = await work();
    finishStage(run.id, output);
    return output;
  } catch (error) {
    failStage(run.id, error);
    throw error;
  }
}

function supportedQuestionType(value: string): 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer' | 'calculation' | 'essay' {
  if (['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'calculation', 'essay'].includes(value)) {
    return value as ReturnType<typeof supportedQuestionType>;
  }
  if (value === 'proof') return 'calculation';
  if (value === 'material') return 'essay';
  return 'short_answer';
}

function expectedAnswerKind(type: string): string {
  if (type === 'single_choice') return 'single_choice';
  if (type === 'multiple_choice') return 'multiple_choice';
  if (type === 'true_false') return 'boolean';
  if (type === 'fill_blank') return 'text';
  if (type === 'calculation') return 'expression';
  return 'subjective';
}

function changeDifficulty(level: 'basic' | 'medium' | 'hard', mode: SimilarJob['difficultyMode']) {
  const levels = ['basic', 'medium', 'hard'] as const;
  const current = levels.indexOf(level);
  const offset = mode === 'lower' ? -1 : mode === 'higher' ? 1 : 0;
  return levels[Math.max(0, Math.min(levels.length - 1, current + offset))];
}

function contentText(blocks: Array<{ content: string }>): string {
  return blocks.map(block => block.content).join('\n');
}

function deterministicFindings(draft: AnsweredDraft) {
  const findings: Array<{ code: string; severity: 'error' | 'critical'; message: string; entityId: string | null }> = [];
  const question = draft.question;
  const subScore = question.subquestions.reduce((sum, item) => sum + item.score, 0);
  const rubricScore = draft.rubric.items.reduce((sum, item) => sum + item.points, 0);
  if (!draft.answer.answer) findings.push({ code: 'ANSWER_MISSING', severity: 'critical', message: '缺少参考答案', entityId: question.slotId });
  if (question.subquestions.length > 0 && Math.abs(subScore - question.score) > 1e-6) findings.push({ code: 'SUBQUESTION_SCORE_MISMATCH', severity: 'error', message: '子题分值之和不等于题目分值', entityId: question.slotId });
  if (Math.abs(rubricScore - question.score) > 1e-6) findings.push({ code: 'RUBRIC_SCORE_MISMATCH', severity: 'critical', message: '评分标准合计不等于题目分值', entityId: question.slotId });
  if (draft.similarity >= 0.72) findings.push({ code: 'SOURCE_QUESTION_TOO_SIMILAR', severity: 'critical', message: '新题与原题形态过于相似', entityId: question.slotId });
  if (['single_choice', 'multiple_choice'].includes(question.questionType) && question.options.length < 2) findings.push({ code: 'OPTIONS_INVALID', severity: 'critical', message: '选择题选项不足', entityId: question.slotId });
  const answer = draft.answer.answer;
  const optionIds = new Set(question.options.map(option => option.id));
  if (answer?.kind === 'single_choice' && !optionIds.has(answer.optionId)) findings.push({ code: 'ANSWER_NOT_IN_OPTIONS', severity: 'critical', message: '单选答案不在选项中', entityId: question.slotId });
  if (answer?.kind === 'multiple_choice' && answer.optionIds.some(id => !optionIds.has(id))) findings.push({ code: 'ANSWER_NOT_IN_OPTIONS', severity: 'critical', message: '多选答案包含无效选项', entityId: question.slotId });
  return findings;
}

async function parseSource(job: SimilarJob): Promise<ParsedOutput> {
  const run = await runStructuredPrompt(questionParsingPrompt, {
    sourceExamId: job.id, sourceDocumentId: job.id,
    questionSections: [{ id: 'user-input', pageStart: 1, pageEnd: 1 }],
    pages: [{ pageNumber: 1, text: job.sourceText, blockIds: ['user-input'] }],
  }, { maxTokens: 6000, maxRetries: 2, similarQuestionJobId: job.id });
  if (run.output.status !== 'ok' || run.output.questions.length === 0) throw new Error('没有从输入内容中识别到题目，请检查题号和题干');
  return run.output;
}

async function buildTaxonomy(job: SimilarJob, parsed: ParsedOutput): Promise<TaxonomyOutput> {
  const run = await runStructuredPrompt(taxonomyGenerationPrompt, {
    course: { id: job.id, name: job.course, description: job.scope }, taxonomyScope: 'local_question_set', materialSummaries: [],
    questions: parsed.questions.map(question => ({ id: question.temporaryId, stem: question.rawStem, evidence: question.evidence })), existingNodes: [],
  }, { maxTokens: 4000, maxRetries: 2, similarQuestionJobId: job.id });
  if (run.output.status !== 'ok' || run.output.nodes.length === 0) throw new Error('AI 未能从原题提取可靠考点');
  return run.output;
}

async function classify(job: SimilarJob, parsed: ParsedOutput, taxonomy: TaxonomyOutput): Promise<ClassificationOutput> {
  const run = await runStructuredPrompt(classificationPrompt, {
    questions: parsed.questions.map(question => ({ id: question.temporaryId, questionType: question.questionType, stem: question.rawStem, score: question.originalScore, evidence: question.evidence })),
    taxonomyNodes: taxonomy.nodes.map(node => ({ id: node.temporaryId, name: node.name, parentId: node.parentTemporaryId, isLocked: false })),
    lockedClassifications: [],
  }, { maxTokens: 5000, maxRetries: 2, similarQuestionJobId: job.id });
  if (run.output.status !== 'ok' || run.output.classifications.length !== parsed.questions.length) throw new Error('原题考点或难度分类不完整');
  return run.output;
}

async function generateDrafts(job: SimilarJob, parsed: ParsedOutput, taxonomy: TaxonomyOutput, classified: ClassificationOutput): Promise<GeneratedDraft[]> {
  const results: GeneratedDraft[] = [];
  const taxonomyNames = new Map(taxonomy.nodes.map(node => [node.temporaryId, node.name]));
  for (let sourceIndex = 0; sourceIndex < parsed.questions.length; sourceIndex += 1) {
    const source = parsed.questions[sourceIndex];
    const classification = classified.classifications.find(item => item.questionId === source.temporaryId);
    if (!classification || classification.status !== 'classified') throw new Error(`第 ${source.originalQuestionNo} 题分类不确定，未生成新题`);
    const kpIds = classification.knowledgePoints.map(item => item.knowledgePointId);
    const kpNames = kpIds.map(id => taxonomyNames.get(id) ?? id);
    const type = supportedQuestionType(source.questionType);
    for (let variant = 0; variant < job.variantsPerQuestion; variant += 1) {
      const axis = variationAxes[(sourceIndex * job.variantsPerQuestion + variant) % variationAxes.length];
      const forbidden = [{ questionId: `source-${source.temporaryId}`, normalizedStem: source.rawStem }, ...results.map((item, index) => ({ questionId: `generated-${index + 1}`, normalizedStem: contentText(item.question.stem) }))];
      let accepted: GeneratedDraft | null = null;
      for (let originalityAttempt = 0; originalityAttempt < 3; originalityAttempt += 1) {
        const run = await runStructuredPrompt(questionGenerationPrompt, {
          course: { id: job.id, name: job.course, scope: job.scope },
          slot: {
            id: `${source.temporaryId}-v${variant + 1}`, setNo: 1, knowledgePointIds: kpIds,
            questionType: type, score: source.originalScore ?? job.defaultScore,
            difficultyLevel: changeDifficulty(classification.difficulty.difficultyLevel, job.difficultyMode),
            cognitiveLevel: classification.cognitiveLevel, expectedAnswerKind: expectedAnswerKind(type), variationAxis: axis,
            contentRequirements: { formula: true, image: false, code: type === 'short_answer', table: true, material: true },
          },
          referenceMaterials: [{ sourceDocumentId: job.id, excerpt: source.rawStem, evidence: source.evidence }],
          forbiddenQuestions: forbidden,
        }, { maxTokens: 5000, maxRetries: 2, similarQuestionJobId: job.id, modelParameters: { originalityAttempt } });
        if (run.output.status !== 'ok') continue;
        const similarity = questionSimilarity(source.rawStem, contentText(run.output.stem));
        if (similarity < 0.72) {
          accepted = { sourceQuestionNo: source.originalQuestionNo, sourceStem: source.rawStem, knowledgePointNames: kpNames, variationAxis: axis, similarity, question: run.output, questionAiRunId: run.aiRunId, questionPromptVersionId: run.promptVersionId };
          break;
        }
        forbidden.push({ questionId: `too-similar-${originalityAttempt + 1}`, normalizedStem: contentText(run.output.stem) });
      }
      if (!accepted) throw new Error(`第 ${source.originalQuestionNo} 题连续生成结果与原题过于相似`);
      results.push(accepted);
    }
  }
  return results;
}

async function answerDrafts(job: SimilarJob, drafts: GeneratedDraft[]): Promise<AnsweredDraft[]> {
  const config = getConfig();
  const results: AnsweredDraft[] = [];
  // This stage may have persisted a subset before a process/API failure. Its stage
  // output is the commit marker, so an uncached retry must rebuild only those
  // incomplete artifacts instead of accumulating duplicate generated questions.
  db.delete(schema.generatedQuestions)
    .where(eq(schema.generatedQuestions.similarQuestionJobId, job.id)).run();
  saveToDisk();
  for (const draft of drafts) {
    const question = draft.question;
    const answerRun = await runStructuredPrompt(answerGenerationPrompt, {
      question: { id: question.slotId, questionType: question.questionType, stem: question.stem, options: question.options, subquestions: question.subquestions, score: question.score },
      expectedAnswerKind: expectedAnswerKind(question.questionType), referenceMaterials: [],
    }, { maxTokens: 5000, maxRetries: 2, similarQuestionJobId: job.id });
    if (answerRun.output.status !== 'ok' || !answerRun.output.answer) throw new Error(`题位 ${question.slotId} 无法生成可靠答案`);
    const rubricRun = await runStructuredPrompt(rubricGenerationPrompt, {
      question: { id: question.slotId, questionType: question.questionType, stem: question.stem, subquestions: question.subquestions, score: question.score },
      answer: { answer: answerRun.output.answer, explanation: answerRun.output.explanation, keySteps: answerRun.output.keySteps, acceptableAlternatives: answerRun.output.acceptableAlternatives },
    }, { maxTokens: 5000, maxRetries: 2, similarQuestionJobId: job.id });
    if (rubricRun.output.status !== 'ok') throw new Error(`题位 ${question.slotId} 无法生成可靠评分标准`);
    const generated = db.insert(schema.generatedQuestions).values({
      similarQuestionJobId: job.id, setNo: 1, questionType: supportedQuestionType(question.questionType),
      stem: JSON.stringify(question.stem), options: JSON.stringify(question.options), subquestions: JSON.stringify(question.subquestions), score: question.score,
      answer: JSON.stringify(answerRun.output.answer), explanation: JSON.stringify(answerRun.output.explanation), knowledgePointIds: JSON.stringify(draft.knowledgePointNames),
      cognitiveLevel: question.cognitiveLevel, difficulty: JSON.stringify(question.difficulty), sourceQuestionIds: JSON.stringify([draft.sourceQuestionNo]),
      provider: config.provider, model: config.model, promptVersionId: draft.questionPromptVersionId,
      generationParameters: JSON.stringify({ variationAxis: draft.variationAxis, similarity: draft.similarity }), aiRunId: draft.questionAiRunId, status: 'draft',
    }).returning().get();
    db.insert(schema.rubrics).values({
      generatedQuestionId: generated.id, totalScore: rubricRun.output.totalScore, items: JSON.stringify(rubricRun.output.items),
      generalRule: rubricRun.output.generalRule, provider: config.provider, model: config.model,
      promptVersionId: rubricRun.promptVersionId, generationParameters: JSON.stringify({ source: 'similar_question_pipeline' }), aiRunId: rubricRun.aiRunId, status: 'draft',
    }).run();
    saveToDisk();
    results.push({ ...draft, answer: answerRun.output, rubric: rubricRun.output, generatedQuestionId: generated.id });
  }
  return results;
}

async function validateDrafts(job: SimilarJob, drafts: AnsweredDraft[]) {
  const items = [];
  for (const draft of drafts) {
    const deterministic = deterministicFindings(draft);
    const validationRun = await runStructuredPrompt(independentValidationPrompt, {
      scope: 'answer', canonicalObject: { question: draft.question, answer: draft.answer, rubric: draft.rubric },
      constraints: { sourceQuestion: draft.sourceStem, maximumSimilarity: 0.72, variationAxis: draft.variationAxis },
      deterministicFindings: deterministic, sourceEvidence: [],
    }, { maxTokens: 3500, maxRetries: 2, similarQuestionJobId: job.id });
    const findings = [...deterministic, ...validationRun.output.findings];
    const blocking = findings.filter(item => item.severity === 'error' || item.severity === 'critical');
    if (validationRun.output.status !== 'ok' || blocking.length > 0) {
      throw new Error(`题位 ${draft.question.slotId} 质量校验未通过：${blocking.map(item => item.code).join(', ') || 'VALIDATION_UNCERTAIN'}`);
    }
    db.update(schema.generatedQuestions).set({ status: 'generated', updatedAt: new Date().toISOString() })
      .where(eq(schema.generatedQuestions.id, draft.generatedQuestionId)).run();
    db.update(schema.rubrics).set({ status: 'validated', updatedAt: new Date().toISOString() })
      .where(eq(schema.rubrics.generatedQuestionId, draft.generatedQuestionId)).run();
    items.push({
      generatedQuestionId: draft.generatedQuestionId, sourceQuestionNo: draft.sourceQuestionNo,
      questionType: supportedQuestionType(draft.question.questionType), stem: draft.question.stem, options: draft.question.options,
      subquestions: draft.question.subquestions, score: draft.question.score, knowledgePoints: draft.knowledgePointNames,
      cognitiveLevel: draft.question.cognitiveLevel, difficulty: draft.question.difficulty, answer: draft.answer.answer,
      explanation: draft.answer.explanation, rubric: { totalScore: draft.rubric.totalScore, items: draft.rubric.items, generalRule: draft.rubric.generalRule },
      originality: { similarity: draft.similarity, notes: draft.question.originalityNotes, variationAxis: draft.variationAxis },
      validation: { passed: true, findings }, savedQuestionId: null,
    });
  }
  saveToDisk();
  return { items };
}

export async function runSimilarQuestionJob(jobId: number): Promise<void> {
  if (activeJobs.has(jobId)) return;
  const job = db.select().from(schema.similarQuestionJobs).where(eq(schema.similarQuestionJobs.id, jobId)).get();
  if (!job || job.status === 'saved') return;
  if (!isConfigured()) {
    const now = new Date().toISOString();
    db.update(schema.similarQuestionJobs).set({ status: 'failed', taskStatus: 'failed', errorSummary: 'AI 未配置，请设置 AI_API_KEY', finishedAt: now, updatedAt: now }).where(eq(schema.similarQuestionJobs.id, jobId)).run();
    saveToDisk();
    return;
  }
  activeJobs.add(jobId);
  try {
    const parsed = await executeStage(jobId, 'question_parsing', { sourceLength: job.sourceText.length }, () => parseSource(job));
    const taxonomy = await executeStage(jobId, 'taxonomy_generation', { questionCount: parsed.questions.length }, () => buildTaxonomy(job, parsed));
    const classified = await executeStage(jobId, 'classification', { questionCount: parsed.questions.length, taxonomyCount: taxonomy.nodes.length }, () => classify(job, parsed, taxonomy));
    const drafts = await executeStage(jobId, 'question_generation', { questionCount: parsed.questions.length, variantsPerQuestion: job.variantsPerQuestion }, () => generateDrafts(job, parsed, taxonomy, classified));
    const answered = await executeStage(jobId, 'answer_and_rubric_generation', { generatedCount: drafts.length }, () => answerDrafts(job, drafts));
    const validated = await executeStage(jobId, 'independent_validation', { generatedCount: answered.length }, () => validateDrafts(job, answered));
    const result = { sourceQuestions: parsed.questions, items: validated.items };
    const now = new Date().toISOString();
    db.update(schema.similarQuestionJobs).set({ status: 'succeeded', taskStatus: 'succeeded', currentStage: null, lastSuccessfulStage: 'independent_validation', errorSummary: null, resultJson: JSON.stringify(result), finishedAt: now, updatedAt: now })
      .where(eq(schema.similarQuestionJobs.id, jobId)).run();
    saveToDisk();
  } catch (error) {
    if (error instanceof JobCancelledError) {
      const now = new Date().toISOString();
      db.update(schema.similarQuestionJobs).set({ taskStatus: 'cancelled', currentStage: null, finishedAt: now, updatedAt: now })
        .where(eq(schema.similarQuestionJobs.id, jobId)).run();
      saveToDisk();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    db.update(schema.similarQuestionJobs).set({ status: 'failed', taskStatus: 'failed', errorSummary: message, finishedAt: now, updatedAt: now })
      .where(eq(schema.similarQuestionJobs.id, jobId)).run();
    saveToDisk();
  } finally {
    activeJobs.delete(jobId);
  }
}

export function retrySimilarQuestionJob(jobId: number): void {
  db.update(schema.similarQuestionJobs).set({ status: 'pending', taskStatus: 'retrying', errorSummary: null,
    cancelRequestedAt: null, finishedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.similarQuestionJobs.id, jobId)).run();
  saveToDisk();
  setTimeout(() => { void runSimilarQuestionJob(jobId); }, 0);
}

export function cancelSimilarQuestionJob(jobId: number): void {
  const now = new Date().toISOString();
  db.update(schema.similarQuestionJobs).set({ taskStatus: 'cancelled', cancelRequestedAt: now,
    finishedAt: now, updatedAt: now }).where(eq(schema.similarQuestionJobs.id, jobId)).run();
  saveToDisk();
}

export function resumeSimilarQuestionJobs(): void {
  const now = new Date().toISOString();
  db.update(schema.similarQuestionJobStages).set({
    status: 'failed', retryable: true,
    errorMessage: '服务进程重启，已从该阶段重新执行',
    finishedAt: now, updatedAt: now,
  }).where(eq(schema.similarQuestionJobStages.status, 'running')).run();
  const jobs = db.select({ id: schema.similarQuestionJobs.id }).from(schema.similarQuestionJobs)
    .where(and(inArray(schema.similarQuestionJobs.status, ['pending', 'running']), ne(schema.similarQuestionJobs.taskStatus, 'cancelled')))
    .orderBy(asc(schema.similarQuestionJobs.id)).all();
  if (jobs.length > 0) saveToDisk();
  for (const job of jobs) setTimeout(() => { void runSimilarQuestionJob(job.id); }, 0);
}
