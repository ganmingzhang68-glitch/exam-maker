import type { ApiResponse, Paper, PaperDetail, PaperStatus } from '@exam-maker/shared';
import api from './api';

export interface CreatePaperInput {
  title: string;
  course: string;
  description?: string | null;
  instructions?: string | null;
  durationMinutes?: number;
  status?: PaperStatus;
  sourceProjectId?: number | null;
}

export async function listPapers(status?: PaperStatus): Promise<Paper[]> {
  const response = await api.get<ApiResponse<Paper[]>>('/papers', { params: status ? { status } : {} });
  return response.data.data ?? [];
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
