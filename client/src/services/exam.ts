import type {
  Answer,
  AnswerContent,
  ApiResponse,
  AttemptDetail,
  StudentExamSummary,
  StudentAttemptResult,
  TeacherAttemptGradingDetail,
  TeacherExamSummary,
  TeacherExamStudentResult,
  ExamAssessment,
} from '@exam-maker/shared';
import api from './api';

export interface ExamInput {
  paperId: number;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  allowedAttempts: number;
  fillBlankIgnoreCase: boolean;
  showAnswers: boolean;
  showAnalysis: boolean;
}

export async function listTeacherExams(): Promise<TeacherExamSummary[]> {
  const response = await api.get<ApiResponse<TeacherExamSummary[]>>('/exams');
  return response.data.data ?? [];
}

export async function createExam(values: ExamInput): Promise<TeacherExamSummary> {
  const response = await api.post<ApiResponse<TeacherExamSummary>>('/exams', values);
  return response.data.data!;
}

export async function updateExam(id: number, values: Partial<ExamInput>): Promise<TeacherExamSummary> {
  const response = await api.patch<ApiResponse<TeacherExamSummary>>(`/exams/${id}`, values);
  return response.data.data!;
}

export async function publishExam(id: number): Promise<TeacherExamSummary> {
  const response = await api.post<ApiResponse<TeacherExamSummary>>(`/exams/${id}/publish`);
  return response.data.data!;
}

export async function closeExam(id: number): Promise<TeacherExamSummary> {
  const response = await api.post<ApiResponse<TeacherExamSummary>>(`/exams/${id}/close`);
  return response.data.data!;
}

export async function listStudentExams(): Promise<StudentExamSummary[]> {
  const response = await api.get<ApiResponse<StudentExamSummary[]>>('/exams/mine');
  return response.data.data ?? [];
}

export async function startExam(id: number): Promise<AttemptDetail> {
  const response = await api.post<ApiResponse<AttemptDetail>>(`/exams/${id}/start`);
  return response.data.data!;
}

export async function getAttempt(id: number): Promise<AttemptDetail> {
  const response = await api.get<ApiResponse<AttemptDetail>>(`/attempts/${id}`);
  return response.data.data!;
}

export async function saveAnswer(
  attemptId: number,
  paperQuestionId: number,
  content: AnswerContent | null,
): Promise<Answer> {
  const response = await api.put<ApiResponse<Answer>>(
    `/attempts/${attemptId}/answers/${paperQuestionId}`,
    { content },
  );
  return response.data.data!;
}

export async function submitAttempt(id: number): Promise<AttemptDetail & { idempotent: boolean }> {
  const response = await api.post<ApiResponse<AttemptDetail & { idempotent: boolean }>>(`/attempts/${id}/submit`);
  return response.data.data!;
}

export async function listExamResults(examId: number): Promise<TeacherExamStudentResult[]> {
  const response = await api.get<ApiResponse<TeacherExamStudentResult[]>>(`/exams/${examId}/results`);
  return response.data.data ?? [];
}

export async function getExamAssessment(examId: number): Promise<ExamAssessment> {
  const response = await api.get<ApiResponse<ExamAssessment>>(`/exams/${examId}/quality`);
  return response.data.data!;
}

export async function reviewExamQuestionQuality(examId: number, paperQuestionId: number, action: 'confirm' | 'ignore' | 'needs_revision'): Promise<void> {
  await api.post(`/exams/${examId}/quality/questions/${paperQuestionId}/review`, { action });
}

export async function getTeacherAttemptResult(
  examId: number,
  attemptId: number,
): Promise<TeacherAttemptGradingDetail> {
  const response = await api.get<ApiResponse<TeacherAttemptGradingDetail>>(
    `/exams/${examId}/attempts/${attemptId}`,
  );
  return response.data.data!;
}

export async function gradeSubjectiveAnswer(
  examId: number,
  attemptId: number,
  answerId: number,
  score: number,
  feedback?: string | null,
): Promise<TeacherAttemptGradingDetail> {
  const response = await api.patch<ApiResponse<TeacherAttemptGradingDetail>>(
    `/exams/${examId}/attempts/${attemptId}/answers/${answerId}/grade`,
    { score, feedback: feedback ?? null },
  );
  return response.data.data!;
}

export async function getStudentResult(attemptId: number): Promise<StudentAttemptResult> {
  const response = await api.get<ApiResponse<StudentAttemptResult>>(`/attempts/${attemptId}/result`);
  return response.data.data!;
}
