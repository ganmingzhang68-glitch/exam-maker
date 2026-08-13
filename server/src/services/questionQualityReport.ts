import { and, eq } from 'drizzle-orm';
import type { ExamAssessment } from '@exam-maker/shared';
import { db, saveToDisk, schema } from '../db/index.js';

export function syncQuestionQualityReports(assessment: ExamAssessment): ExamAssessment {
  const now = new Date().toISOString();
  for (const item of assessment.items) {
    db.insert(schema.questionQualityReports).values({
      examId: assessment.examId, paperQuestionId: item.paperQuestionId, questionId: item.questionId,
      sampleSize: item.sampleSize, correctRate: item.correctRate, empiricalDifficulty: item.empiricalDifficulty,
      discriminationIndex: item.discriminationIndex, pointBiserial: item.pointBiserialCorrelation,
      optionStatistics: JSON.stringify(item.optionStatistics), blankRate: item.blankRate,
      averageScoreRate: item.averageScoreRate, qualityFlags: JSON.stringify(item.flags), metricStatus: item.status,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.questionQualityReports.examId, schema.questionQualityReports.paperQuestionId],
      set: { sampleSize: item.sampleSize, correctRate: item.correctRate, empiricalDifficulty: item.empiricalDifficulty,
        discriminationIndex: item.discriminationIndex, pointBiserial: item.pointBiserialCorrelation,
        optionStatistics: JSON.stringify(item.optionStatistics), blankRate: item.blankRate,
        averageScoreRate: item.averageScoreRate, qualityFlags: JSON.stringify(item.flags), metricStatus: item.status,
        updatedAt: now },
    }).run();
  }
  saveToDisk();
  const reviewByQuestion = new Map(db.select().from(schema.questionQualityReports)
    .where(eq(schema.questionQualityReports.examId, assessment.examId)).all()
    .map(row => [row.paperQuestionId, row.reviewStatus]));
  return { ...assessment, items: assessment.items.map(item => ({ ...item,
    reviewStatus: reviewByQuestion.get(item.paperQuestionId) ?? 'pending' })) };
}

export function reviewQuestionQuality(examId: number, paperQuestionId: number, action: 'confirm' | 'ignore' | 'needs_revision', userId: number) {
  const report = db.select().from(schema.questionQualityReports).where(and(
    eq(schema.questionQualityReports.examId, examId),
    eq(schema.questionQualityReports.paperQuestionId, paperQuestionId),
  )).get();
  if (!report) return null;
  const now = new Date().toISOString();
  const reviewStatus = action === 'confirm' ? 'confirmed' as const : action === 'ignore' ? 'ignored' as const : 'needs_revision' as const;
  const updated = db.update(schema.questionQualityReports).set({ reviewStatus, reviewedBy: userId, reviewedAt: now, updatedAt: now })
    .where(eq(schema.questionQualityReports.id, report.id)).returning().get();
  if (action === 'needs_revision') {
    db.update(schema.questions).set({ lifecycleStatus: 'needs_review', updatedAt: now })
      .where(eq(schema.questions.id, report.questionId)).run();
  }
  saveToDisk();
  return updated;
}
