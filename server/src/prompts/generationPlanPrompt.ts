import { z } from 'zod';
import { difficultyPromptSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const planSectionSchema = z.object({ id: z.string().min(1), questionType: z.string().min(1), questionCount: z.number().int().positive(), subtotal: z.number().positive() }).strict();
const targetCellSchema = z.object({ knowledgePointId: z.string().min(1), questionType: z.string().min(1), cognitiveLevel: z.string().min(1), difficultyLevel: z.enum(['basic', 'medium', 'hard']), questionCount: z.number().int().nonnegative(), score: z.number().nonnegative() }).strict();

export const generationPlanInputSchema = z.object({
  numberOfSets: z.number().int().positive().max(50), totalScorePerSet: z.number().positive(),
  assessmentTemplate: z.object({ sections: z.array(planSectionSchema).min(1), totalScore: z.number().positive() }).strict(),
  targetBlueprint: z.object({ id: z.number().int().positive(), cells: z.array(targetCellSchema).min(1) }).strict(),
  tolerances: z.object({ difficulty: z.number().min(0).max(1), knowledgeCoverage: z.number().min(0).max(1) }).strict(),
  materialCapabilities: z.object({ formula: z.boolean(), image: z.boolean(), code: z.boolean(), table: z.boolean(), material: z.boolean() }).strict(),
}).strict();

const planSlotOutputSchema = z.object({
  id: z.string().min(1), setNo: z.number().int().positive(), sectionId: z.string().min(1), order: z.number().int().positive(),
  knowledgePointIds: z.array(z.string().min(1)).min(1), questionType: z.string().min(1), score: z.number().positive(),
  difficulty: difficultyPromptSchema, cognitiveLevel: z.string().min(1),
  expectedAnswerKind: z.enum(['single_choice', 'multiple_choice', 'boolean', 'text', 'numeric', 'expression', 'subjective']),
  contentRequirements: z.object({ formula: z.boolean(), image: z.boolean(), code: z.boolean(), material: z.boolean(), table: z.boolean() }).strict(),
  correspondingSlotKey: z.string().nullable(),
}).strict();

export const generationPlanOutputSchema = z.object({
  status: promptStatusSchema, totalScorePerSet: z.number().positive(), slots: z.array(planSlotOutputSchema), conflicts: z.array(z.string()), issues: z.array(promptIssueSchema),
}).strict();

export const generationPlanPrompt: PromptDefinition<typeof generationPlanInputSchema, typeof generationPlanOutputSchema> = {
  id: 'generation_plan_prompt', version: '1.0.0', stage: 'paper_generation_planning',
  task: '只把已确认 AssessmentTemplate 和 TargetBlueprint 分解为逐套逐题 slot。不得生成题面，不得改变题量、分区小计或每套总分；约束冲突时返回 uncertain。',
  inputSchema: generationPlanInputSchema, outputSchema: generationPlanOutputSchema,
  outputContract: { status: 'ok|uncertain', totalScorePerSet: 'number', slots: 'GenerationPlanSlot[]', conflicts: 'string[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { numberOfSets: input.numberOfSets, totalScorePerSet: input.totalScorePerSet, assessmentTemplate: input.assessmentTemplate, targetBlueprint: input.targetBlueprint, tolerances: input.tolerances, materialCapabilities: input.materialCapabilities }, untrustedData: {} }),
  examples: {
    correct: { status: 'ok', totalScorePerSet: 10, slots: [{ id: 'set1-s1-q1', setNo: 1, sectionId: 's1', order: 1, knowledgePointIds: ['kp-1'], questionType: 'short_answer', score: 10, difficulty: { difficultyLevel: 'medium', difficultyScore: 0.5, difficultySource: 'predicted', difficultyReason: '目标细目表指定中等', confidence: 0.8, empiricalSampleSize: null }, cognitiveLevel: 'apply', expectedAnswerKind: 'text', contentRequirements: { formula: false, image: false, code: false, material: false, table: false }, correspondingSlotKey: 's1-q1' }], conflicts: [], issues: [] },
    exceptional: { status: 'uncertain', totalScorePerSet: 10, slots: [], conflicts: ['模板要求10分，但目标细目表合计12分'], issues: [{ code: 'PLAN_CONSTRAINT_CONFLICT', message: '约束不可同时满足，未修改教师目标', evidence: ['targetBlueprint:1'] }] },
  },
};
