import { z } from 'zod';
import { difficultyPromptSchema, evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const generatedContentBlockSchema = z.object({ type: z.enum(['paragraph', 'math', 'table', 'image', 'code', 'material']), content: z.string().min(1), assetId: z.number().int().positive().nullable() }).strict();

export const questionGenerationInputSchema = z.object({
  course: z.object({ id: z.number().int().positive(), name: z.string().min(1), scope: z.string().nullable() }).strict(),
  slot: z.object({ id: z.string().min(1), setNo: z.number().int().positive(), knowledgePointIds: z.array(z.string()).min(1), questionType: z.string().min(1), score: z.number().positive(), difficultyLevel: z.enum(['basic', 'medium', 'hard']), cognitiveLevel: z.string().min(1), expectedAnswerKind: z.string().min(1), contentRequirements: z.record(z.boolean()) }).strict(),
  referenceMaterials: z.array(z.object({ sourceDocumentId: z.number().int().positive(), excerpt: z.string(), evidence: z.array(evidenceSchema) }).strict()),
  forbiddenQuestions: z.array(z.object({ questionId: z.string().min(1), normalizedStem: z.string().min(1) }).strict()),
}).strict();

export const questionGenerationOutputSchema = z.object({
  status: promptStatusSchema, slotId: z.string().min(1), questionType: z.string().min(1),
  stem: z.array(generatedContentBlockSchema).min(1),
  options: z.array(z.object({ id: z.string().min(1), content: z.array(generatedContentBlockSchema).min(1) }).strict()),
  subquestions: z.array(z.object({ id: z.string().min(1), label: z.string().nullable(), stem: z.array(generatedContentBlockSchema).min(1), score: z.number().nonnegative() }).strict()),
  score: z.number().positive(), knowledgePointIds: z.array(z.string()).min(1), cognitiveLevel: z.string().min(1),
  difficulty: difficultyPromptSchema, sourceEvidence: z.array(evidenceSchema), originalityNotes: z.string().min(1), issues: z.array(promptIssueSchema),
}).strict();

export const questionGenerationPrompt: PromptDefinition<typeof questionGenerationInputSchema, typeof questionGenerationOutputSchema> = {
  id: 'question_generation_prompt', version: '1.0.0', stage: 'question_generation',
  task: '只为一个 GenerationPlan slot 生成题面。输出 Schema 故意不含 answer、explanation、rubric 或渲染格式；禁止输出这些内容，也不得复制历史题。',
  inputSchema: questionGenerationInputSchema, outputSchema: questionGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', slotId: 'string', questionType: 'string', stem: 'ContentBlock[]', options: 'Option[]', subquestions: 'Subquestion[]', score: 'number', knowledgePointIds: 'string[]', cognitiveLevel: 'string', difficulty: 'DifficultyAssessment', sourceEvidence: 'Evidence[]', originalityNotes: 'string', issues: 'Issue[]', additionalProperties: false, forbiddenFields: ['answer', 'explanation', 'rubric'] },
  splitInput: input => ({ trustedContext: { course: input.course, slot: input.slot, forbiddenQuestionIds: input.forbiddenQuestions.map(q => q.questionId) }, untrustedData: { referenceMaterials: input.referenceMaterials, forbiddenQuestions: input.forbiddenQuestions } }),
  examples: {
    correct: { status: 'ok', slotId: 'set1-q1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: '结合材料说明核心概念。', assetId: null }], options: [], subquestions: [], score: 5, knowledgePointIds: ['kp-1'], cognitiveLevel: 'understand', difficulty: { difficultyLevel: 'basic', difficultyScore: 0.3, difficultySource: 'predicted', difficultyReason: '单一概念解释', confidence: 0.8, empiricalSampleSize: null }, sourceEvidence: [{ sourceDocumentId: 12, pageNumber: 2, blockId: 'm1', quote: '核心概念定义' }], originalityNotes: '使用新情境，未复用历史题句式', issues: [] },
    exceptional: { status: 'uncertain', slotId: 'set1-q1', questionType: 'short_answer', stem: [{ type: 'paragraph', content: '无法在当前材料范围内形成可靠题面', assetId: null }], options: [], subquestions: [], score: 5, knowledgePointIds: ['kp-1'], cognitiveLevel: 'understand', difficulty: { difficultyLevel: 'basic', difficultyScore: 0.3, difficultySource: 'predicted', difficultyReason: '计划目标值，仅作占位', confidence: 0.1, empiricalSampleSize: null }, sourceEvidence: [], originalityNotes: '未生成可交付题目', issues: [{ code: 'INSUFFICIENT_SOURCE_MATERIAL', message: '材料不足，题目需重新规划', evidence: ['slot:set1-q1'] }] },
  },
};
