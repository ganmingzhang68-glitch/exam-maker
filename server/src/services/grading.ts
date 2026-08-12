import type { AnswerContent, QuestionType } from '@exam-maker/shared';
import { eq } from 'drizzle-orm';
import { db, rawDb, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePaperSnapshot } from './attemptSnapshot.js';

const objectiveTypes = new Set<QuestionType>([
  'single_choice', 'multiple_choice', 'true_false', 'fill_blank',
]);

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function scalarAnswer(answerKey: Record<string, unknown> | null): unknown {
  if (!answerKey) return null;
  for (const key of ['option', 'value', 'answer', 'text', 'latex']) {
    if (answerKey[key] !== undefined) return answerKey[key];
  }
  const first = Object.values(answerKey)[0];
  return first ?? null;
}

function normalizedText(value: unknown, ignoreCase = false): string {
  const text = String(value ?? '').trim();
  return ignoreCase ? text.toLocaleLowerCase() : text;
}

function answerArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => normalizedText(item)).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[，,;；|]/).map((item) => item.trim()).filter(Boolean);
  }
  return value === null || value === undefined ? [] : [normalizedText(value)];
}

function booleanAnswer(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const normalized = normalizedText(value, true);
  if (['true', '1', '正确', '对', '是', 'yes'].includes(normalized)) return true;
  if (['false', '0', '错误', '错', '否', 'no'].includes(normalized)) return false;
  return null;
}

export interface ObjectiveGradeResult {
  correct: boolean;
  score: number;
}

export function isObjectiveType(type: QuestionType): boolean {
  return objectiveTypes.has(type);
}

export function gradeObjectiveAnswer(
  type: QuestionType,
  content: AnswerContent | null,
  answerKey: Record<string, unknown> | null,
  maxScore: number,
  fillBlankIgnoreCase = false,
): ObjectiveGradeResult {
  if (!isObjectiveType(type)) return { correct: false, score: 0 };
  let correct = false;
  const standard = scalarAnswer(answerKey);
  if (type === 'multiple_choice') {
    const standardValue = answerKey?.options ?? answerKey?.answer ?? answerKey?.value ?? standard;
    const expected = new Set(answerArray(standardValue));
    const actual = new Set(answerArray(content));
    correct = expected.size > 0 && expected.size === actual.size && [...expected].every((item) => actual.has(item));
  } else if (type === 'true_false') {
    const expected = booleanAnswer(standard);
    const actual = booleanAnswer(content);
    correct = expected !== null && actual !== null && expected === actual;
  } else if (type === 'fill_blank') {
    correct = standard !== null &&
      normalizedText(content, fillBlankIgnoreCase) === normalizedText(standard, fillBlankIgnoreCase);
  } else {
    correct = standard !== null && normalizedText(content) === normalizedText(standard);
  }
  return { correct, score: correct ? maxScore : 0 };
}

export function getQuestionSolution(paperQuestionId: number): {
  answerKey: Record<string, unknown> | null;
  analysis: string | null;
} {
  const row = db.select({
    paperQuestion: schema.paperQuestions,
    question: schema.questions,
  }).from(schema.paperQuestions)
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.id, paperQuestionId)).get();
  if (!row) return { answerKey: null, analysis: null };
  const snapshot = parseJson<Record<string, unknown>>(row.paperQuestion.questionSnapshot);
  const answerKey = snapshot?.answerKey && typeof snapshot.answerKey === 'object' && !Array.isArray(snapshot.answerKey)
    ? snapshot.answerKey as Record<string, unknown>
    : parseJson<Record<string, unknown>>(row.question.answerKey);
  const analysis = typeof snapshot?.analysis === 'string' ? snapshot.analysis : row.question.analysis;
  return { answerKey, analysis };
}

export function recalculateAttemptScores(attemptId: number): typeof schema.attempts.$inferSelect {
  const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
  if (!attempt) throw new AppError(404, '作答记录不存在');
  const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
  if (!snapshot) throw new AppError(409, '作答记录缺少题目快照');
  const answers = db.select().from(schema.answers).where(eq(schema.answers.attemptId, attemptId)).all();
  const answerByQuestion = new Map(answers.map((answer) => [answer.paperQuestionId, answer]));
  let objectiveScore = 0;
  let subjectiveScore = 0;
  let allSubjectiveGraded = true;
  let hasSubjective = false;
  for (const question of snapshot.questions) {
    const answer = answerByQuestion.get(question.paperQuestionId);
    if (isObjectiveType(question.type)) {
      objectiveScore += answer?.finalScore ?? 0;
    } else {
      hasSubjective = true;
      if (answer?.gradingStatus !== 'manual_graded') allSubjectiveGraded = false;
      subjectiveScore += answer?.finalScore ?? 0;
    }
  }
  const status = hasSubjective && !allSubjectiveGraded ? 'grading' : 'graded';
  const completedAt = status === 'graded' ? attempt.gradedAt ?? new Date().toISOString() : null;
  const finalGrader = status === 'graded'
    ? attempt.gradedBy ?? answers.find((answer) => answer.gradingStatus === 'manual_graded' && answer.gradedBy)?.gradedBy ?? null
    : null;
  const row = db.update(schema.attempts).set({
    objectiveScore,
    subjectiveScore,
    totalScore: objectiveScore + subjectiveScore,
    status,
    gradedBy: finalGrader,
    gradedAt: completedAt,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.attempts.id, attemptId)).returning().get();
  return row;
}

export function gradeAttempt(attemptId: number): typeof schema.attempts.$inferSelect {
  const attempt = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
  if (!attempt) throw new AppError(404, '作答记录不存在');
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, attempt.examId)).get();
  if (!exam) throw new AppError(404, '考试不存在');
  const snapshot = parsePaperSnapshot(attempt.paperSnapshot);
  if (!snapshot) throw new AppError(409, '作答记录缺少题目快照');
  const now = new Date().toISOString();
  rawDb.run('BEGIN');
  try {
    for (const question of snapshot.questions) {
      let answer = db.select().from(schema.answers).where(eq(
        schema.answers.attemptId,
        attemptId,
      )).all().find((item) => item.paperQuestionId === question.paperQuestionId);
      if (!answer) {
        answer = db.insert(schema.answers).values({
          attemptId,
          paperQuestionId: question.paperQuestionId,
          content: null,
          savedAt: now,
        }).returning().get();
      }
      if (isObjectiveType(question.type)) {
        const content = parseJson<AnswerContent>(answer.content);
        const { answerKey } = getQuestionSolution(question.paperQuestionId);
        const result = gradeObjectiveAnswer(
          question.type,
          content,
          answerKey,
          question.score,
          exam.fillBlankIgnoreCase,
        );
        db.update(schema.answers).set({
          autoScore: result.score,
          manualScore: null,
          finalScore: result.score,
          isCorrect: result.correct,
          gradingStatus: 'auto_graded',
          gradedBy: null,
          gradedAt: now,
          updatedAt: now,
        }).where(eq(schema.answers.id, answer.id)).run();
      } else if (answer.gradingStatus !== 'manual_graded') {
        db.update(schema.answers).set({
          autoScore: null,
          manualScore: null,
          finalScore: null,
          isCorrect: null,
          gradingStatus: 'ungraded',
          gradedBy: null,
          gradedAt: null,
          updatedAt: now,
        }).where(eq(schema.answers.id, answer.id)).run();
      }
    }
    db.update(schema.attempts).set({
      submittedAt: attempt.submittedAt ?? now,
      updatedAt: now,
    }).where(eq(schema.attempts.id, attemptId)).run();
    const result = recalculateAttemptScores(attemptId);
    rawDb.run('COMMIT');
    return result;
  } catch (error) {
    try { rawDb.run('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw error;
  }
}
