import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AiGradingSuggestion, AnswerContent, QuestionType } from '@exam-maker/shared';
import { aiGradingPrompt } from '../prompts/aiGradingPrompt.js';
import { db, saveToDisk, schema } from '../db/index.js';
import { getConfig } from './ai.js';
import { parsePaperSnapshot } from './attemptSnapshot.js';
import { runStructuredPrompt, type PromptRunOptions } from './promptRunner.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export function serializeAiGradingSuggestion(row: typeof schema.aiGradingSuggestions.$inferSelect): AiGradingSuggestion {
  return { ...row,
    rubricItemScores: parseJson<AiGradingSuggestion['rubricItemScores']>(row.rubricItemScores) ?? [],
    missingPoints: parseJson<string[]>(row.missingPoints) ?? [], matchedPoints: parseJson<string[]>(row.matchedPoints) ?? [],
  };
}

export function latestAiGradingSuggestion(answerId: number): AiGradingSuggestion | null {
  const row = db.select().from(schema.aiGradingSuggestions).where(eq(schema.aiGradingSuggestions.answerId, answerId))
    .orderBy(desc(schema.aiGradingSuggestions.id)).get();
  return row ? serializeAiGradingSuggestion(row) : null;
}

interface NormalizedRubricItem {
  id: string;
  description: string;
  points: number;
  acceptableExpressions: string[];
  equivalentSolutions: string[];
  partialCreditRule: string | null;
}

function normalizeRubric(value: Record<string, unknown> | null, maxScore: number) {
  const rows = Array.isArray(value?.items) ? value.items : [];
  const items: NormalizedRubricItem[] = rows.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const points = Number(item.points ?? item.score);
    const description = String(item.description ?? item.criterion ?? '').trim();
    if (!Number.isFinite(points) || points <= 0 || !description) return [];
    return [{ id: String(item.id ?? `r${index + 1}`), description, points,
      acceptableExpressions: Array.isArray(item.acceptableExpressions) ? item.acceptableExpressions.map(String) : [],
      equivalentSolutions: Array.isArray(item.equivalentSolutions) ? item.equivalentSolutions.map(String) : [],
      partialCreditRule: typeof item.partialCreditRule === 'string' ? item.partialCreditRule : null }];
  });
  const totalScore = Number(value?.totalScore ?? value?.total_score ?? maxScore);
  if (!items.length || !Number.isFinite(totalScore) || Math.abs(items.reduce((sum, item) => sum + item.points, 0) - maxScore) > 1e-6) {
    throw new Error('该题缺少可执行的逐项评分标准，不能生成 AI 评分建议');
  }
  return { totalScore: maxScore, items, generalRule: typeof value?.generalRule === 'string' ? value.generalRule : null };
}

function gradingContext(answerId: number) {
  const answer = db.select().from(schema.answers).where(eq(schema.answers.id, answerId)).get();
  if (!answer) throw new Error('答案不存在');
  const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, answer.attemptId)).get();
  if (!attempt) throw new Error('作答记录不存在');
  const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
  const question = snapshot?.questions.find(item => item.paperQuestionId === answer.paperQuestionId);
  if (!question) throw new Error('作答快照中不存在该题目');
  const source = db.select({ paperQuestion: schema.paperQuestions, question: schema.questions })
    .from(schema.paperQuestions).innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.id, answer.paperQuestionId)).get();
  if (!source) throw new Error('题目来源不存在');
  const frozen = parseJson<Record<string, unknown>>(source.paperQuestion.questionSnapshot);
  const answerKey = frozen?.answerKey && typeof frozen.answerKey === 'object' && !Array.isArray(frozen.answerKey)
    ? frozen.answerKey as Record<string, unknown> : parseJson<Record<string, unknown>>(source.question.answerKey);
  const rubricValue = frozen?.scoringRubric && typeof frozen.scoringRubric === 'object' && !Array.isArray(frozen.scoringRubric)
    ? frozen.scoringRubric as Record<string, unknown> : parseJson<Record<string, unknown>>(source.question.scoringRubric);
  if (!answerKey) throw new Error('该题缺少参考答案，不能生成 AI 评分建议');
  return { answer, question, answerKey, rubric: normalizeRubric(rubricValue, question.score) };
}

export function queueAiGradingSuggestion(answerId: number): AiGradingSuggestion {
  const { question } = gradingContext(answerId);
  const existing = db.select().from(schema.aiGradingSuggestions).where(and(
    eq(schema.aiGradingSuggestions.answerId, answerId),
    inArray(schema.aiGradingSuggestions.status, ['queued', 'running']),
  )).orderBy(desc(schema.aiGradingSuggestions.id)).get();
  if (existing) return serializeAiGradingSuggestion(existing);
  db.update(schema.aiGradingSuggestions).set({ status: 'superseded', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.aiGradingSuggestions.answerId, answerId), eq(schema.aiGradingSuggestions.status, 'succeeded'))).run();
  const config = getConfig();
  const row = db.insert(schema.aiGradingSuggestions).values({ answerId, maxScore: question.score,
    provider: config.provider, model: config.model, status: 'queued' }).returning().get();
  saveToDisk();
  return serializeAiGradingSuggestion(row);
}

export async function runAiGradingSuggestion(suggestionId: number, options: PromptRunOptions = {}): Promise<AiGradingSuggestion> {
  const suggestion = db.select().from(schema.aiGradingSuggestions).where(eq(schema.aiGradingSuggestions.id, suggestionId)).get();
  if (!suggestion) throw new Error('AI 评分建议任务不存在');
  if (!['queued', 'failed'].includes(suggestion.status)) return serializeAiGradingSuggestion(suggestion);
  const now = new Date().toISOString();
  db.update(schema.aiGradingSuggestions).set({ status: 'running', errorMessage: null, updatedAt: now })
    .where(eq(schema.aiGradingSuggestions.id, suggestionId)).run(); saveToDisk();
  try {
    const context = gradingContext(suggestion.answerId);
    const run = await runStructuredPrompt(aiGradingPrompt, {
      question: { id: String(context.question.questionId), type: context.question.type as QuestionType,
        stem: context.question.stem, maxScore: context.question.score },
      referenceAnswer: context.answerKey, rubric: context.rubric,
      studentAnswer: parseJson<AnswerContent>(context.answer.content),
    }, { maxTokens: 3500, maxRetries: 2, ...options });
    if (run.output.status !== 'ok' || run.output.suggestedScore === null) throw new Error('AI 无法给出可靠评分建议');
    if (Math.abs(run.output.maxScore - context.question.score) > 1e-6) throw new Error('AI 返回的题目满分与作答快照不一致');
    const expected = new Map(context.rubric.items.map(item => [item.id, item.points]));
    if (run.output.rubricItemScores.length !== expected.size || run.output.rubricItemScores.some(item => expected.get(item.rubricItemId) !== item.maxScore)) {
      throw new Error('AI 返回的评分项与冻结 Rubric 不一致');
    }
    const updated = db.update(schema.aiGradingSuggestions).set({
      suggestedScore: run.output.suggestedScore, rubricItemScores: JSON.stringify(run.output.rubricItemScores),
      reasoningSummary: run.output.reasoningSummary, missingPoints: JSON.stringify(run.output.missingPoints),
      matchedPoints: JSON.stringify(run.output.matchedPoints), confidence: run.output.confidence,
      promptVersionId: run.promptVersionId, aiRunId: run.aiRunId, status: 'succeeded', updatedAt: new Date().toISOString(),
    }).where(eq(schema.aiGradingSuggestions.id, suggestionId)).returning().get();
    saveToDisk(); return serializeAiGradingSuggestion(updated);
  } catch (error) {
    const updated = db.update(schema.aiGradingSuggestions).set({ status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() })
      .where(eq(schema.aiGradingSuggestions.id, suggestionId)).returning().get();
    saveToDisk(); return serializeAiGradingSuggestion(updated);
  }
}
