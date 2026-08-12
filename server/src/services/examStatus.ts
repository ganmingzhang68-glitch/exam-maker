import type { StudentExamAvailability, StudentExamDisplayStatus, StudentExamSummary } from '@exam-maker/shared';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { serializeAttempt } from './attemptSnapshot.js';
import { gradeAttempt } from './grading.js';

type ExamRow = typeof schema.exams.$inferSelect;
type AttemptRow = typeof schema.attempts.$inferSelect;

function isExpired(attempt: AttemptRow, exam: ExamRow, now: number): boolean {
  return attempt.status === 'in_progress' && (
    (attempt.expiresAt !== null && new Date(attempt.expiresAt).getTime() <= now) ||
    (exam.endAt !== null && new Date(exam.endAt).getTime() <= now) ||
    exam.status === 'closed'
  );
}

export function settleExpiredAttempts(exam: ExamRow, attempts: AttemptRow[], now = Date.now()): boolean {
  let changed = false;
  for (const attempt of attempts) {
    if (isExpired(attempt, exam, now)) {
      gradeAttempt(attempt.id);
      changed = true;
    }
  }
  return changed;
}

export function displayStatus(exam: ExamRow, latest: AttemptRow | null, now = Date.now()): StudentExamDisplayStatus {
  if (latest?.status === 'in_progress') return 'in_progress';
  if (latest?.status === 'submitted') return 'submitted';
  if (latest?.status === 'grading') return 'grading';
  if (latest?.status === 'graded') return 'graded';
  if (exam.status === 'closed' || (exam.endAt && new Date(exam.endAt).getTime() <= now)) return 'ended';
  if (exam.startAt && new Date(exam.startAt).getTime() > now) return 'upcoming';
  return 'available';
}

export function getStudentExamSummaries(studentId: number, now = Date.now()): { data: StudentExamSummary[]; changed: boolean } {
  const assignments = db.select({ assignment: schema.examAssignments, exam: schema.exams, paper: schema.papers })
    .from(schema.examAssignments)
    .innerJoin(schema.exams, eq(schema.examAssignments.examId, schema.exams.id))
    .innerJoin(schema.papers, eq(schema.exams.paperId, schema.papers.id))
    .where(eq(schema.examAssignments.studentId, studentId))
    .orderBy(desc(schema.exams.startAt)).all();
  let changed = false;
  const data = assignments.map(({ exam, paper }): StudentExamSummary => {
    let attempts = db.select().from(schema.attempts).where(and(
      eq(schema.attempts.examId, exam.id), eq(schema.attempts.studentId, studentId),
    )).orderBy(desc(schema.attempts.attemptNo)).all();
    if (settleExpiredAttempts(exam, attempts, now)) {
      changed = true;
      attempts = db.select().from(schema.attempts).where(and(
        eq(schema.attempts.examId, exam.id), eq(schema.attempts.studentId, studentId),
      )).orderBy(desc(schema.attempts.attemptNo)).all();
    }
    const latest = attempts[0] ?? null;
    const computed = displayStatus(exam, latest, now);
    const availability: StudentExamAvailability = computed === 'upcoming' ? 'upcoming'
      : computed === 'ended' ? 'ended'
        : ['submitted', 'grading', 'graded'].includes(computed) ? 'completed' : 'available';
    return {
      id: exam.id, title: exam.title, status: exam.status, startAt: exam.startAt, endAt: exam.endAt,
      durationMinutes: exam.durationMinutes, allowedAttempts: exam.allowedAttempts,
      paperTitle: paper.title, totalScore: paper.totalScore, attemptCount: attempts.length,
      availability, displayStatus: computed, latestAttempt: latest ? serializeAttempt(latest) : null,
    };
  });
  return { data, changed };
}
