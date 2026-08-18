import type { ApiResponse, Paper, PaperDetail, PaperStatus, PaperSummary } from '@exam-maker/shared';
import api from './api';

export interface CreatePaperInput {
  title: string;
  course: string;
  description?: string | null;
  instructions?: string | null;
  durationMinutes?: number;
  status?: PaperStatus;
  sourceProjectId?: number | null;
  courseId?: number | null;
  creationMethod?: 'ai_generated' | 'manual' | 'imported';
}

export async function listPapers(params?: { status?: PaperStatus; courseId?: number; search?: string }): Promise<PaperSummary[]> {
  const response = await api.get<ApiResponse<PaperSummary[]>>('/papers', { params });
  return response.data.data ?? [];
}

export async function copyPaper(id: number): Promise<PaperDetail> {
  const response = await api.post<ApiResponse<PaperDetail>>(`/papers/${id}/copy`);
  return response.data.data!;
}

export async function createPaper(values: CreatePaperInput): Promise<PaperDetail> {
  const response = await api.post<ApiResponse<PaperDetail>>('/papers', values);
  return response.data.data!;
}

export async function getPaper(id: number): Promise<PaperDetail> {
  const response = await api.get<ApiResponse<PaperDetail>>(`/papers/${id}`);
  return response.data.data!;
}

export async function updatePaper(id: number, values: Partial<CreatePaperInput>): Promise<Paper> {
  const response = await api.patch<ApiResponse<Paper>>(`/papers/${id}`, values);
  return response.data.data!;
}

export async function deletePaper(id: number): Promise<void> {
  await api.delete(`/papers/${id}`);
}

export async function addQuestionToPaper(
  paperId: number,
  questionId: number,
  score?: number,
): Promise<PaperDetail> {
  const response = await api.post<ApiResponse<PaperDetail>>(`/papers/${paperId}/questions`, {
    questionId,
    ...(score === undefined ? {} : { score }),
  });
  return response.data.data!;
}

export async function updatePaperQuestion(
  paperId: number,
  paperQuestionId: number,
  values: { score?: number; sectionTitle?: string | null },
): Promise<PaperDetail> {
  const response = await api.patch<ApiResponse<PaperDetail>>(
    `/papers/${paperId}/questions/${paperQuestionId}`,
    values,
  );
  return response.data.data!;
}

export async function removePaperQuestion(
  paperId: number,
  paperQuestionId: number,
): Promise<PaperDetail> {
  const response = await api.delete<ApiResponse<PaperDetail>>(
    `/papers/${paperId}/questions/${paperQuestionId}`,
  );
  return response.data.data!;
}

export async function reorderPaperQuestions(
  paperId: number,
  paperQuestionIds: number[],
): Promise<PaperDetail> {
  const response = await api.patch<ApiResponse<PaperDetail>>(`/papers/${paperId}/questions/reorder`, {
    paperQuestionIds,
  });
  return response.data.data!;
}
