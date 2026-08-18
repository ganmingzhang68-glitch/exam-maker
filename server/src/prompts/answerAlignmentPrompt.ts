import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const answerAlignmentInputSchema = z.object({
  questions: z.array(z.object({ temporaryId: z.string().min(1), originalQuestionNo: z.string().min(1), rawStem: z.string().min(1), evidence: z.array(evidenceSchema) }).strict()).min(1),
  answerCandidates: z.array(z.object({ candidateId: z.string().min(1), originalQuestionNo: z.string().nullable(), rawAnswer: z.string().min(1), rawAnalysis: z.string().nullable(), evidence: z.array(evidenceSchema).min(1) }).strict()),
}).strict();

export const answerAlignmentOutputSchema = z.object({
  status: promptStatusSchema,
  alignments: z.array(z.object({
    questionTemporaryId: z.string().min(1), answerCandidateId: z.string().nullable(),
    alignmentStatus: z.enum(['aligned', 'uncertain', 'unmatched']),
    rawAnswer: z.string().nullable(), rawAnalysis: z.string().nullable(), confidence: z.number().min(0).max(1),
    evidence: z.array(evidenceSchema), reason: z.string().min(1),
  }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const answerAlignmentPrompt: PromptDefinition<typeof answerAlignmentInputSchema, typeof answerAlignmentOutputSchema> = {
  id: 'answer_alignment_prompt', version: '1.0.0', stage: 'question_answer_alignment',
  task: '只将输入中的答案候选关联到输入中的题目。禁止自行解题、补写答案或修改题面。每道题必须返回 aligned、uncertain 或 unmatched。',
  inputSchema: answerAlignmentInputSchema, outputSchema: answerAlignmentOutputSchema,
  outputContract: { status: 'ok|uncertain', alignments: 'AnswerAlignment[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { questionIds: input.questions.map(q => q.temporaryId), answerCandidateIds: input.answerCandidates.map(a => a.candidateId) }, untrustedData: { questions: input.questions, answerCandidates: input.answerCandidates } }),
  examples: {
    correct: { status: 'ok', alignments: [{ questionTemporaryId: 'q-1', answerCandidateId: 'a-1', alignmentStatus: 'aligned', rawAnswer: 'A', rawAnalysis: null, confidence: 0.99, evidence: [{ sourceDocumentId: 11, pageNumber: 3, blockId: 'a1', quote: '1. A' }], reason: '原题号完全一致' }], issues: [] },
    exceptional: { status: 'uncertain', alignments: [{ questionTemporaryId: 'q-1', answerCandidateId: null, alignmentStatus: 'unmatched', rawAnswer: null, rawAnalysis: null, confidence: 0, evidence: [], reason: '答案材料中没有对应题号' }], issues: [{ code: 'ANSWER_NOT_FOUND', message: '不得以模型求解结果替代原始答案', evidence: ['question:q-1'] }] },
  },
};
