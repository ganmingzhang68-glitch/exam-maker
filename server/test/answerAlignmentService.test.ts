import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuestionNumber, validateAlignments } from '../src/services/answerAlignment.js';
import type { z } from 'zod';
import { answerAlignmentOutputSchema } from '../src/prompts/answerAlignmentPrompt.js';

const evidence = [{ sourceDocumentId: 1, pageNumber: 2, blockId: null, quote: 'answer' }];
function output(alignments: z.input<typeof answerAlignmentOutputSchema>['alignments']): z.output<typeof answerAlignmentOutputSchema> {
  return answerAlignmentOutputSchema.parse({ status: 'ok', alignments, issues: [] });
}

test('normalizes main and sub-question numbers without array-index matching', () => {
  assert.equal(normalizeQuestionNumber(' 2（1） '), '2.1');
  assert.equal(normalizeQuestionNumber('第3题'), '3');
});

test('marks missing and shifted answers for teacher review', () => {
  const rows = validateAlignments(
    [{ id: 10, originalQuestionNo: '1' }, { id: 20, originalQuestionNo: '2' }],
    [{ id: 101, normalizedNumber: '2', answerContent: 'B' }],
    output([
      { questionTemporaryId: '10', answerCandidateId: '101', alignmentStatus: 'aligned', rawAnswer: 'B', rawAnalysis: null, confidence: 0.98, evidence, reason: 'claimed' },
      { questionTemporaryId: '20', answerCandidateId: null, alignmentStatus: 'unmatched', rawAnswer: null, rawAnalysis: null, confidence: 0, evidence: [], reason: 'missing' },
    ]),
  );
  assert.deepEqual(rows.map((row) => [row.sourceQuestionId, row.alignmentStatus, row.requiresTeacherReview]), [
    [10, 'conflicting_candidates', true], [20, 'missing_answer', true],
  ]);
});

test('detects duplicate answer numbers and supports exact sub-question alignment', () => {
  const duplicate = validateAlignments(
    [{ id: 10, originalQuestionNo: '2(1)' }],
    [{ id: 101, normalizedNumber: '2.1', answerContent: 'x' }, { id: 102, normalizedNumber: '2.1', answerContent: 'y' }],
    output([{ questionTemporaryId: '10', answerCandidateId: '101', alignmentStatus: 'aligned', rawAnswer: 'x', rawAnalysis: null, confidence: 0.99, evidence, reason: 'same number' }]),
  );
  assert.equal(duplicate[0].alignmentStatus, 'duplicate_candidate');
  const exact = validateAlignments(
    [{ id: 10, originalQuestionNo: '2(1)' }],
    [{ id: 101, normalizedNumber: '2.1', answerContent: 'x' }],
    output([{ questionTemporaryId: '10', answerCandidateId: '101', alignmentStatus: 'aligned', rawAnswer: 'x', rawAnalysis: null, confidence: 0.99, evidence, reason: 'same number' }]),
  );
  assert.equal(exact[0].alignmentStatus, 'matched');
  assert.equal(exact[0].requiresTeacherReview, false);
});
