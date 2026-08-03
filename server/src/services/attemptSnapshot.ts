import type { AttemptDetail, AttemptPaperSnapshot, AttemptQuestionSnapshot } from '@exam-maker/shared';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { AppError } from '../middleware/errorHandler.js';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function visibleQuestion(
  paperQuestion: typeof schema.paperQuestions.$inferSelect,
  question: typeof schema.questions.$inferSelect,
): AttemptQuestionSnapshot {
  const stored = parseJson<Record<string, unknown>>(paperQuestion.questionSnapshot);
  const storedOptions = stored?.options;
  return {
    paperQuestionId: paperQuestion.id,
    questionId: paperQuestion.questionId,
    orderNo: paperQuestion.orderNo,
    sectionTitle: paperQuestion.sectionTitle,
    score: paperQuestion.score,
    type: (typeof stored?.type === 'string' ? stored.type : question.type) as AttemptQuestionSnapshot['type'],
    stem: typeof stored?.stem === 'string' ? stored.stem : question.stem,
    options: Array.isArray(storedOptions)
      ? storedOptions.map(String)
      : parseJson<string[]>(question.options),
  };
}

export function ensurePaperQuestionSnapshots(paperId: number): void {
  const rows = db.select({
    paperQuestion: schema.paperQuestions,
    question: schema.questions,
  }).from(schema.paperQuestions)
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.paperId, paperId))
    .all();
  for (const { paperQuestion, question } of rows) {
    if (paperQuestion.questionSnapshot) continue;
    db.update(schema.paperQuestions).set({
      questionSnapshot: JSON.stringify({
        ...question,
        options: parseJson<string[]>(question.options),
        answerKey: parseJson<Record<string, unknown>>(question.answerKey),
        scoringRubric: parseJson<Record<string, unknown>>(question.scoringRubric),
        knowledgePoints: parseJson<string[]>(question.knowledgePoints),
        metadata: parseJson<Record<string, unknown>>(question.metadata),
      }),
    }).where(eq(schema.paperQuestions.id, paperQuestion.id)).run();
  }
}

export function buildPaperSnapshot(paperId: number): AttemptPaperSnapshot {
  const paper = db.select().from(schema.papers).where(eq(schema.papers.id, paperId)).get();
  if (!paper) throw new AppError(404, '试卷不存在');
  const rows = db.select({
    paperQuestion: schema.paperQuestions,
    question: schema.questions,
  }).from(schema.paperQuestions)
    .innerJoin(schema.questions, eq(schema.paperQuestions.questionId, schema.questions.id))
    .where(eq(schema.paperQuestions.paperId, paperId))
    .orderBy(schema.paperQuestions.orderNo)
    .all();
  if (rows.length === 0) throw new AppError(409, '试卷没有题目，不能开始考试');
  return {
    paper: {
      id: paper.id,
      title: paper.title,
      course: paper.course,
      instructions: paper.instructions,
      totalScore: paper.totalScore,
    },
    questions: rows.map((row) => visibleQuestion(row.paperQuestion, row.question)),
  };
}

export function parsePaperSnapshot(value: string | null): AttemptPaperSnapshot | null {
  return parseJson<AttemptPaperSnapshot>(value);
}

export function serializeAttempt(row: typeof schema.attempts.$inferSelect) {
  return { ...row, paperSnapshot: parsePaperSnapshot(row.paperSnapshot) };
}

export function getAttemptDetail(attemptId: number): AttemptDetail {
  const attemptRow = db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId)).get();
  if (!attemptRow) throw new AppError(404, '作答记录不存在');
  const exam = db.select().from(schema.exams).where(eq(schema.exams.id, attemptRow.examId)).get();
  if (!exam) throw new AppError(404, '考试不存在');
  let snapshot = parsePaperSnapshot(attemptRow.paperSnapshot);
  if (!snapshot) {
    snapshot = buildPaperSnapshot(exam.paperId);
    db.update(schema.attempts).set({ paperSnapshot: JSON.stringify(snapshot) })
      .where(eq(schema.attempts.id, attemptId)).run();
  }
  const answerRows = db.select().from(schema.answers)
    .where(eq(schema.answers.attemptId, attemptId)).all();
  return {
    attempt: { ...attemptRow, paperSnapshot: snapshot },
    exam: {
      id: exam.id,
      title: exam.title,
      endAt: exam.endAt,
      durationMinutes: exam.durationMinutes,
    },
    paper: snapshot.paper,
    questions: snapshot.questions,
    answers: answerRows.map((answer) => ({
      ...answer,
      content: parseJson(answer.content),
    })),
  };
}
