import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

const taxonomyNodeInputSchema = z.object({ id: z.string().min(1), parentId: z.string().nullable(), name: z.string().min(1), isLocked: z.boolean() }).strict();

export const taxonomyGenerationInputSchema = z.object({
  course: z.object({ id: z.number().int().positive(), name: z.string().min(1), description: z.string().nullable() }).strict(),
  taxonomyScope: z.enum(['course', 'local_question_set']).default('course'),
  materialSummaries: z.array(z.object({ sourceDocumentId: z.number().int().positive(), summary: z.string(), evidence: z.array(evidenceSchema) }).strict()),
  questions: z.array(z.object({ id: z.string().min(1), stem: z.string().min(1), evidence: z.array(evidenceSchema) }).strict()),
  existingNodes: z.array(taxonomyNodeInputSchema),
}).strict();

export const taxonomyGenerationOutputSchema = z.object({
  status: promptStatusSchema,
  nodes: z.array(z.object({
    temporaryId: z.string().min(1), existingNodeId: z.string().nullable(), parentTemporaryId: z.string().nullable(),
    code: z.string().min(1), name: z.string().min(1), description: z.string().nullable(), aliases: z.array(z.string()),
    action: z.enum(['keep', 'propose_create', 'propose_rename', 'propose_move']), confidence: z.number().min(0).max(1), evidence: z.array(evidenceSchema),
  }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const taxonomyGenerationPrompt: PromptDefinition<typeof taxonomyGenerationInputSchema, typeof taxonomyGenerationOutputSchema> = {
  id: 'taxonomy_generation_prompt', version: '1.0.1', stage: 'knowledge_taxonomy_building',
  task: '只依据课程材料和历史题证据提出考点节点。taxonomyScope=course 时建立课程考点树，证据不足以形成稳定层级时返回 uncertain；taxonomyScope=local_question_set 时只提取当前题目明确考查的局部考点，不声称它是完整课程体系，只要题干明确包含可命名的学科概念，一道题也构成充分证据。不得内置特定课程考点，不得覆盖 existingNodes 中 isLocked=true 的名称或父节点。',
  inputSchema: taxonomyGenerationInputSchema, outputSchema: taxonomyGenerationOutputSchema,
  outputContract: { status: 'ok|uncertain', nodes: 'TaxonomyNodeProposal[]', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { course: input.course, taxonomyScope: input.taxonomyScope, existingNodes: input.existingNodes }, untrustedData: { materialSummaries: input.materialSummaries, questions: input.questions } }),
  examples: {
    correct: { status: 'ok', nodes: [{ temporaryId: 'kp-1', existingNodeId: null, parentTemporaryId: null, code: 'K1', name: '核心概念', description: '由教学材料章节标题归纳', aliases: [], action: 'propose_create', confidence: 0.86, evidence: [{ sourceDocumentId: 12, pageNumber: 2, blockId: 'm1', quote: '第一章 核心概念' }] }], issues: [] },
    exceptional: { status: 'uncertain', nodes: [], issues: [{ code: 'INSUFFICIENT_TAXONOMY_EVIDENCE', message: '材料和题目不足以建立稳定层级', evidence: ['course:1'] }] },
  },
};
