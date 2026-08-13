import { and, desc, eq } from 'drizzle-orm';
import type { AttemptPaperSnapshot, QuestionType } from '@exam-maker/shared';
import { db, schema } from '../db/index.js';
import { calculateAssessmentMetrics, type AssessmentItemInput, type AssessmentResponseInput } from './assessmentMetrics.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function optionId(value: unknown): string {
  const text = String(value ?? '').trim();
  const match = text.match(/^([A-Za-z0-9]+)[.、:：)）\s]/);
  return (match?.[1] ?? text).toUpperCase();
}

function optionsFrom(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((option, index) => {
    if (typeof option === 'object' && option !== null) {
      const item = option as Record<string, unknown>;
      return { id: optionId(item.id ?? String.fromCharCode(65 + index)), text: String(item.text ?? item.content ?? '') };
    }
    return { id: optionId(option) || String.fromCharCode(65 + index), text: String(option) };
  });
}

function answerValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(answerValues);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['options', 'selected', 'option', 'answer', 'value']) {
      if (object[key] !== undefined) return answerValues(object[key]);
    }
    return [];
  }
  if (value === null || value === undefined || String(value).trim() === '') return [];
  return String(value).split(/[，,;；|]/).map(optionId).filter(Boolean);
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
  const paperRows = db.select({ paperQuestion: schema.paperQuestions, question: schema.questions })
    .from(schema.paperQuestions).innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.paperId, paper.id)).orderBy(schema.paperQuestions.orderNo).all();
  const sourceById = new Map(paperRows.map(row => [row.paperQuestion.id, row]));

  let items: AssessmentItemInput[] = [];
  if (firstSnapshot) {
    items = firstSnapshot.questions.map(question => {
      const source = sourceById.get(question.paperQuestionId);
      const stored = parseJson<Record<string, unknown>>(source?.paperQuestion.questionSnapshot ?? null);
      const answerKey = stored?.answerKey ?? parseJson<Record<string, unknown>>(source?.question.answerKey ?? null);
      return { paperQuestionId: question.paperQuestionId, questionId: question.questionId, orderNo: question.orderNo,
        stem: question.stem, type: question.type, maxScore: question.score,
        options: optionsFrom(question.options ?? stored?.options), correctOptionIds: answerValues(answerKey) };
    });
  } else {
    items = paperRows.map(({ paperQuestion, question }) => {
      const snapshot = parseJson<Record<string, unknown>>(paperQuestion.questionSnapshot);
      return { paperQuestionId: paperQuestion.id, questionId: paperQuestion.questionId, orderNo: paperQuestion.orderNo,
        stem: typeof snapshot?.stem === 'string' ? snapshot.stem : question.stem,
        type: (typeof snapshot?.type === 'string' ? snapshot.type : question.type) as QuestionType,
        maxScore: paperQuestion.score, options: optionsFrom(snapshot?.options ?? parseJson(question.options)),
        correctOptionIds: answerValues(snapshot?.answerKey ?? parseJson(question.answerKey)) };
    });
  }

  const responses: AssessmentResponseInput[] = attempts.map(attempt => {
    const answerRows = db.select().from(schema.answers).where(eq(schema.answers.attemptId, attempt.id)).all();
    const itemScores: Record<number, number> = {};
    const itemCorrect: Record<number, boolean | null> = {};
    const itemSelections: Record<number, string[]> = {};
    for (const item of items) {
      const answer = answerRows.find(row => row.paperQuestionId === item.paperQuestionId);
      itemScores[item.paperQuestionId] = answer?.finalScore ?? 0;
      itemCorrect[item.paperQuestionId] = answer?.isCorrect ?? null;
      itemSelections[item.paperQuestionId] = answerValues(parseJson(answer?.content ?? null));
    }
    return { respondentId: attempt.studentId, totalScore: attempt.totalScore, itemScores, itemCorrect, itemSelections };
  });
  return calculateAssessmentMetrics({ examId, paperTitle: paper.title, totalScore: paper.totalScore, items, responses });
}
