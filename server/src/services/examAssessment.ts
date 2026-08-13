import { and, desc, eq } from 'drizzle-orm';
import type { AttemptPaperSnapshot, QuestionType } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import { calculateAssessmentMetrics, type AssessmentItemInput, type AssessmentResponseInput } from './assessmentMetrics.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export function buildExamAssessment(examId: number) {
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, examId)).get();
  if (!exam) return null;
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, exam.paperId)).get();
  if (!paper) return null;
  const allCompleted = db.select().from(schema.attempts).where(and(
    eq(schema.attempts.examId, examId), eq(schema.attempts.status, 'graded'),
  )).orderBy(desc(schema.attempts.attemptNo)).all();
  // A student is one statistical respondent. With retakes, use the latest fully graded attempt.
  const latestByStudent = new Map<number, typeof schema.attempts.$inferSelect>();
  for (const attempt of allCompleted) if (!latestByStudent.has(attempt.studentId)) latestByStudent.set(attempt.studentId, attempt);
  const attempts = [...latestByStudent.values()];
  const firstSnapshot = attempts.map(attempt => parseJson<AttemptPaperSnapshot>(attempt.paperSnapshot)).find(Boolean) ?? null;

  let items: AssessmentItemInput[] = [];
  if (firstSnapshot) {
    items = firstSnapshot.questions.map(question => ({
      paperQuestionId: question.paperQuestionId, questionId: question.questionId, orderNo: question.orderNo,
      stem: question.stem, type: question.type, maxScore: question.score,
    }));
  } else {
    const rows = db.select({ paperQuestion: schema.paperQuestions, question: schema.questions })
      .from(schema.paperQuestions).innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
      .where(eq(schema.paperQuestions.paperId, paper.id)).orderBy(schema.paperQuestions.orderNo).all();
    items = rows.map(({ paperQuestion, question }) => {
      const snapshot = parseJson<Record<string, unknown>>(paperQuestion.questionSnapshot);
      return { paperQuestionId: paperQuestion.id, questionId: paperQuestion.questionId, orderNo: paperQuestion.orderNo,
        stem: typeof snapshot?.stem === 'string' ? snapshot.stem : question.stem,
        type: (typeof snapshot?.type === 'string' ? snapshot.type : question.type) as QuestionType,
        maxScore: paperQuestion.score };
    });
  }

  const responses: AssessmentResponseInput[] = attempts.map(attempt => {
    const answerRows = db.select().from(schema.answers).where(eq(schema.answers.attemptId, attempt.id)).all();
    const itemScores: Record<number, number> = {};
    const itemCorrect: Record<number, boolean | null> = {};
    for (const item of items) {
      const answer = answerRows.find(row => row.paperQuestionId === item.paperQuestionId);
      itemScores[item.paperQuestionId] = answer?.finalScore ?? 0;
      itemCorrect[item.paperQuestionId] = answer?.isCorrect ?? null;
    }
    return { respondentId: attempt.studentId, totalScore: attempt.totalScore, itemScores, itemCorrect };
  });
  return calculateAssessmentMetrics({ examId, paperTitle: paper.title, totalScore: paper.totalScore, items, responses });
}
