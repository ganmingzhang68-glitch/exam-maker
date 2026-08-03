import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const blueprintGenerationInputSchema = z.object({
  kind: z.enum(['historical', 'actual']),
  courseId: z.number().int().positive(), projectId: z.number().int().positive(), totalScore: z.number().positive(),
  questions: z.array(z.object({ id: z.string().min(1), knowledgePointIds: z.array(z.string().min(1)).min(1), questionType: z.string().min(1), cognitiveLevel: z.string().min(1), difficultyLevel: z.enum(['basic', 'medium', 'hard']), score: z.number().positive(), evidence: z.array(evidenceSchema) }).strict()).min(1),
}).strict();

export const blueprintGenerationOutputSchema = z.object({
  status: promptStatusSchema, kind: z.enum(['historical', 'actual']), totalScore: z.number().positive(),
  cells: z.array(z.object({ knowledgePointId: z.string().min(1), questionType: z.string().min(1), cognitiveLevel: z.string().min(1), difficultyLevel: z.enum(['basic', 'medium', 'hard']), questionCount: z.number().int().nonnegative(), score: z.number().nonnegative(), scoreRatio: z.number().min(0).max(1), evidence: z.array(evidenceSchema) }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const blueprintGenerationPrompt: PromptDefinition<typeof blueprintGenerationInputSchema, typeof blueprintGenerationOutputSchema> = {
  id: 'blueprint_generation_prompt', version: '1.0.0', stage: 'historical_blueprint_generation',
  task: '只把已分类题目汇总为 historical 或 actual blueprint 候选。不得创建或批准 TargetBlueprint；不得改变输入题目的分值和分类。',
  inputSchema: blueprintGenerationInputSchema, outputSchema: blueprintGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', kind: 'historical|actual', totalScore: 'number', cells: 'BlueprintCell[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { kind: input.kind, courseId: input.courseId, projectId: input.projectId, totalScore: input.totalScore }, untrustedData: { questions: input.questions } }),
  examples: {
    correct: { status: 'ok', kind: 'historical', totalScore: 10, cells: [{ knowledgePointId: 'kp-1', questionType: 'short_answer', cognitiveLevel: 'understand', difficultyLevel: 'basic', questionCount: 2, score: 10, scoreRatio: 1, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'q1', quote: '题目1' }] }], issues: [] },
    exceptional: { status: 'uncertain', kind: 'actual', totalScore: 10, cells: [], issues: [{ code: 'UNCONFIRMED_CLASSIFICATION', message: '题目分类未确认，不能生成可靠实际细目表', evidence: ['question:q-1'] }] },
  },
};
