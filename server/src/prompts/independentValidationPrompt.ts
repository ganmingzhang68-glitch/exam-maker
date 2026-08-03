import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const independentValidationInputSchema = z.object({
  scope: z.enum(['document_fidelity', 'classification', 'template', 'answer', 'paper_quality', 'export_integrity']),
  canonicalObject: z.record(z.unknown()),
  constraints: z.record(z.unknown()),
  deterministicFindings: z.array(z.object({ code: z.string().min(1), severity: z.enum(['info', 'warning', 'error', 'critical']), message: z.string().min(1), entityId: z.string().nullable() }).strict()),
  sourceEvidence: z.array(evidenceSchema),
}).strict();

export const independentValidationOutputSchema = z.object({
  status: promptStatusSchema, passed: z.boolean(),
  findings: z.array(z.object({ code: z.string().min(1), severity: z.enum(['info', 'warning', 'error', 'critical']), message: z.string().min(1), entityType: z.string().nullable(), entityId: z.string().nullable(), evidence: z.array(evidenceSchema), details: z.record(z.unknown()) }).strict()),
  metrics: z.record(z.number()), issues: z.array(promptIssueSchema),
}).strict().superRefine((value, ctx) => {
  if (value.passed && value.findings.some(f => f.severity === 'error' || f.severity === 'critical')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['passed'], message: '存在严重 finding 时不得 passed=true' });
  }
});

export const independentValidationPrompt: PromptDefinition<typeof independentValidationInputSchema, typeof independentValidationOutputSchema> = {
  id: 'independent_validation_prompt', version: '1.0.0', stage: 'paper_validation',
  task: '只独立报告输入对象的问题，不修改题面、答案、rubric、模板或细目表。不得推翻确定性检查；存在 error/critical finding 时 passed 必须为 false。',
  inputSchema: independentValidationInputSchema, outputSchema: independentValidationOutputSchema,
  outputContract: { status: 'ok|uncertain', passed: 'boolean', findings: 'ValidationFinding[]', metrics: 'Record<string,number>', issues: 'Issue[]', additionalProperties: false },
  splitInput: input => ({ trustedContext: { scope: input.scope, constraints: input.constraints, deterministicFindings: input.deterministicFindings }, untrustedData: { canonicalObject: input.canonicalObject, sourceEvidence: input.sourceEvidence } }),
  examples: {
    correct: { status: 'ok', passed: false, findings: [{ code: 'ANSWER_MISSING', severity: 'error', message: '题目没有参考答案', entityType: 'generated_question', entityId: 'gq-1', evidence: [], details: {} }], metrics: { checkedQuestions: 1 }, issues: [] },
    exceptional: { status: 'uncertain', passed: false, findings: [], metrics: {}, issues: [{ code: 'VALIDATION_INPUT_INCOMPLETE', message: '输入对象被截断，不能给出整卷通过结论', evidence: ['paper:1'] }] },
  },
};
