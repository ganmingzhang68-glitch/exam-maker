import { z } from 'zod';
import { difficultyPromptSchema, evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const classificationInputSchema = z.object({
  questions: z.array(z.object({ id: z.string().min(1), questionType: z.string().min(1), stem: z.string().min(1), score: z.number().nonnegative().nullable(), evidence: z.array(evidenceSchema) }).strict()).min(1),
  taxonomyNodes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), parentId: z.string().nullable(), isLocked: z.boolean() }).strict()).min(1),
  lockedClassifications: z.array(z.object({ questionId: z.string().min(1), knowledgePointId: z.string().min(1), role: z.enum(['primary', 'secondary']) }).strict()),
}).strict();

export const classificationOutputSchema = z.object({
  status: promptStatusSchema,
  classifications: z.array(z.object({
    questionId: z.string().min(1),
    knowledgePoints: z.array(z.object({ knowledgePointId: z.string().min(1), role: z.enum(['primary', 'secondary']), confidence: z.number().min(0).max(1), evidence: z.array(evidenceSchema) }).strict()).min(1),
    cognitiveLevel: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
    difficulty: difficultyPromptSchema,
    status: z.enum(['classified', 'uncertain']),
  }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const classificationPrompt: PromptDefinition<typeof classificationInputSchema, typeof classificationOutputSchema> = {
  id: 'classification_prompt', version: '1.0.0', stage: 'question_classification',
  task: '只把题目关联到输入提供的考点树，并评估认知层级和难度。不得创建新考点，不得覆盖教师锁定分类；没有学生统计时难度来源必须是 predicted。',
  inputSchema: classificationInputSchema, outputSchema: classificationOutputSchema,
  outputContract: { status: 'ok|uncertain', classifications: 'QuestionClassification[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { taxonomyNodes: input.taxonomyNodes, lockedClassifications: input.lockedClassifications }, untrustedData: { questions: input.questions } }),
  examples: {
    correct: { status: 'ok', classifications: [{ questionId: 'q-1', knowledgePoints: [{ knowledgePointId: 'kp-1', role: 'primary', confidence: 0.9, evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'q1', quote: '解释核心概念' }] }], cognitiveLevel: 'understand', difficulty: { difficultyLevel: 'basic', difficultyScore: 0.25, difficultySource: 'predicted', difficultyReason: '单一概念解释', confidence: 0.81, empiricalSampleSize: null }, status: 'classified' }], issues: [] },
    exceptional: { status: 'uncertain', classifications: [], issues: [{ code: 'NO_SUPPORTED_KNOWLEDGE_POINT', message: '现有考点树没有得到题面证据支持的节点', evidence: ['question:q-1'] }] },
  },
};
