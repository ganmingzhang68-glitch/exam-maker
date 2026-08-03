import { z } from 'zod';
import { evidenceSchema, promptIssueSchema, promptStatusSchema, type PromptDefinition } from './core.js';

export const documentStructureInputSchema = z.object({
  document: z.object({
    id: z.number().int().positive(),
    filename: z.string().min(1),
    mimeType: z.string().nullable(),
    pages: z.array(z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
      blockIds: z.array(z.string()).default([]),
    }).strict()).min(1),
  }).strict(),
  course: z.object({ id: z.number().int().positive(), name: z.string().min(1) }).strict().nullable(),
}).strict();

export const documentStructureOutputSchema = z.object({
  status: promptStatusSchema,
  documentId: z.number().int().positive(),
  documentKind: z.enum(['exam', 'answer', 'exam_with_answer', 'syllabus', 'material', 'unknown']),
  pageCount: z.number().int().positive(),
  sections: z.array(z.object({
    id: z.string().min(1),
    title: z.string().nullable(),
    type: z.enum(['header', 'instructions', 'questions', 'answers', 'rubric', 'appendix', 'unknown']),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(evidenceSchema),
  }).strict()),
  issues: z.array(promptIssueSchema),
}).strict();

export const documentStructurePrompt: PromptDefinition<
  typeof documentStructureInputSchema,
  typeof documentStructureOutputSchema
> = {
  id: 'document_structure_prompt',
  version: '1.0.0',
  stage: 'document_extraction',
  task: '只识别文档类型和页级结构区段。不要切分题目、匹配答案、分类考点或生成任何内容。',
  inputSchema: documentStructureInputSchema,
  outputSchema: documentStructureOutputSchema,
  outputContract: {
    status: 'ok|uncertain', documentId: 'integer', documentKind: 'enum', pageCount: 'integer',
    sections: [{ id: 'string', title: 'string|null', type: 'enum', pageStart: 'integer', pageEnd: 'integer', confidence: '0..1', evidence: 'Evidence[]' }],
    issues: 'Issue[]', additionalProperties: false,
  },
  splitInput: input => ({
    trustedContext: { documentId: input.document.id, filename: input.document.filename, mimeType: input.document.mimeType, course: input.course },
    untrustedData: { pages: input.document.pages },
  }),
  examples: {
    correct: {
      status: 'ok', documentId: 10, documentKind: 'exam', pageCount: 2,
      sections: [{
        id: 's1', title: '一、选择题', type: 'questions', pageStart: 1, pageEnd: 2, confidence: 0.96,
        evidence: [{ sourceDocumentId: 10, pageNumber: 1, blockId: 'b1', quote: '一、选择题' }],
      }], issues: [],
    },
    exceptional: {
      status: 'uncertain', documentId: 10, documentKind: 'unknown', pageCount: 1, sections: [],
      issues: [{ code: 'EMPTY_EXTRACTION', message: '页面没有可识别文本', evidence: ['document:10/page:1'] }],
    },
  },
};
