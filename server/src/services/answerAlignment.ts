import { eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { db, schema } from '../db/index.js';
import { answerAlignmentPrompt, answerAlignmentOutputSchema } from '../prompts/answerAlignmentPrompt.js';
import { runStructuredPrompt, type PromptRunOptions } from './promptRunner.js';
import { failGenerationStage, finishGenerationStage, startGenerationStage } from './generationJobService.js';

export type AlignmentStatus = 'matched' | 'uncertain' | 'missing_answer' | 'duplicate_candidate' | 'conflicting_candidates';
export interface ValidatedAlignment {
  sourceQuestionId: number;
  sourceAnswerCandidateId: number | null;
  alignmentStatus: AlignmentStatus;
  confidence: number;
  reason: string;
  normalizedAnswer: string | null;
  requiresTeacherReview: boolean;
  evidence: unknown[];
}

export function normalizeQuestionNumber(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[（(]/g, '.').replace(/[）)]/g, '')
    .replace(/[、．。\s]+/g, '.').replace(/^第|题$/g, '').replace(/^\.+|\.+$/g, '');
  return normalized || null;
}

export function validateAlignments(
  questions: Array<{ id: number; originalQuestionNo: string }>,
  candidates: Array<{ id: number; normalizedNumber: string | null; answerContent: string }>,
  output: z.output<typeof answerAlignmentOutputSchema>,
  confidenceThreshold = 0.75,
): ValidatedAlignment[] {
  const candidateById = new Map(candidates.map((item) => [String(item.id), item]));
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) if (candidate.normalizedNumber) candidateCounts.set(candidate.normalizedNumber, (candidateCounts.get(candidate.normalizedNumber) ?? 0) + 1);
  const alignByQuestion = new Map(output.alignments.map((item) => [item.questionTemporaryId, item]));
  const usedCandidates = new Map<string, number>();
  for (const item of output.alignments) if (item.answerCandidateId) usedCandidates.set(item.answerCandidateId, (usedCandidates.get(item.answerCandidateId) ?? 0) + 1);

  return questions.map((question) => {
    const item = alignByQuestion.get(String(question.id));
    if (!item || !item.answerCandidateId || item.alignmentStatus === 'unmatched') {
      return { sourceQuestionId: question.id, sourceAnswerCandidateId: null, alignmentStatus: 'missing_answer', confidence: item?.confidence ?? 0, reason: item?.reason ?? '模型未返回该题的答案对齐', normalizedAnswer: null, requiresTeacherReview: true, evidence: item?.evidence ?? [] };
    }
    const candidate = candidateById.get(item.answerCandidateId);
    if (!candidate) return { sourceQuestionId: question.id, sourceAnswerCandidateId: null, alignmentStatus: 'uncertain', confidence: 0, reason: '模型引用了不存在的答案候选', normalizedAnswer: null, requiresTeacherReview: true, evidence: item.evidence };
    const normalizedQuestionNo = normalizeQuestionNumber(question.originalQuestionNo);
    const duplicate = candidate.normalizedNumber && (candidateCounts.get(candidate.normalizedNumber) ?? 0) > 1;
    const reused = (usedCandidates.get(item.answerCandidateId) ?? 0) > 1;
    const numberConflict = candidate.normalizedNumber && normalizedQuestionNo && candidate.normalizedNumber !== normalizedQuestionNo;
    let status: AlignmentStatus = 'matched';
    let reason = item.reason;
    if (duplicate) { status = 'duplicate_candidate'; reason = `编号 ${candidate.normalizedNumber} 存在重复答案候选`; }
    else if (reused || numberConflict) { status = 'conflicting_candidates'; reason = reused ? '同一答案候选被关联到多道题' : '题号与答案候选编号冲突'; }
    else if (item.alignmentStatus === 'uncertain' || item.confidence < confidenceThreshold) status = 'uncertain';
    return { sourceQuestionId: question.id, sourceAnswerCandidateId: candidate.id, alignmentStatus: status, confidence: item.confidence, reason, normalizedAnswer: candidate.answerContent, requiresTeacherReview: status !== 'matched', evidence: item.evidence };
  });
}

export async function alignSourceQuestionAnswers(generationJobId: number, sourceQuestionIds: number[], candidateIds: number[], options: PromptRunOptions = {}) {
  const questions = db.select().from(schema.sourceQuestions).where(inArray(schema.sourceQuestions.id, sourceQuestionIds)).all();
  const candidates = db.select().from(schema.sourceAnswerCandidates).where(inArray(schema.sourceAnswerCandidates.id, candidateIds)).all();
  const stageRun = startGenerationStage(generationJobId, 'question_answer_alignment', { sourceQuestionIds, candidateIds });
  try {
    const result = await runStructuredPrompt(answerAlignmentPrompt, {
      questions: questions.map((q) => ({ temporaryId: String(q.id), originalQuestionNo: q.originalQuestionNo, rawStem: q.rawStem, evidence: [{ sourceDocumentId: q.sourceDocumentId, pageNumber: q.pageStart, blockId: null, quote: q.rawStem }] })),
      answerCandidates: candidates.map((a) => ({ candidateId: String(a.id), originalQuestionNo: a.rawNumber, rawAnswer: a.answerContent, rawAnalysis: a.explanationContent, evidence: [{ sourceDocumentId: a.sourceDocumentId, pageNumber: a.page, blockId: null, quote: a.sourceText }] })),
    }, { ...options, generationJobId, stageRunId: stageRun.id });
    const validated = validateAlignments(questions, candidates, result.output);
    for (const alignment of validated) {
      db.insert(schema.questionAnswerAlignments).values({
        sourceQuestionId: alignment.sourceQuestionId,
        sourceAnswerCandidateId: alignment.sourceAnswerCandidateId,
        generationStageRunId: stageRun.id,
        alignmentStatus: alignment.alignmentStatus,
        confidence: alignment.confidence,
        reason: alignment.reason,
        normalizedAnswer: alignment.normalizedAnswer,
        requiresTeacherReview: alignment.requiresTeacherReview,
        sourceEvidence: JSON.stringify(alignment.evidence),
      }).run();
      db.update(schema.sourceQuestions).set({
        rawAnswer: alignment.alignmentStatus === 'matched' ? alignment.normalizedAnswer : null,
        alignmentConfidence: alignment.confidence,
        teacherReviewStatus: alignment.requiresTeacherReview ? 'needs_alignment_review' : 'aligned',
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.sourceQuestions.id, alignment.sourceQuestionId)).run();
    }
    finishGenerationStage(stageRun.id, validated);
    return validated;
  } catch (error) {
    failGenerationStage(stageRun.id, error, true);
    throw error;
  }
}
