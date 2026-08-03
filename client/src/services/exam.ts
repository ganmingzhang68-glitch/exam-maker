import type {
  Answer,
  AnswerContent,
  ApiResponse,
  AttemptDetail,
  StudentExamSummary,
  TeacherExamSummary,
} from '@exam-maker/shared';
import api from './api';

export interface ExamInput {
  paperId: number;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  allowedAttempts: number;
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
