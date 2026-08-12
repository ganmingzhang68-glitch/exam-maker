import type {
  ApiResponse,
  SimilarQuestionDifficultyMode,
  SimilarQuestionJob,
} from '@exam-maker/shared';
import api from './api';

export interface CreateSimilarQuestionJobInput {
  course: string;
  scope?: string | null;
  sourceText: string;
  sourceAnswer?: string | null;
  variantsPerQuestion: number;
  defaultScore: number;
  difficultyMode: SimilarQuestionDifficultyMode;
}

export async function createSimilarQuestionJob(input: CreateSimilarQuestionJobInput): Promise<SimilarQuestionJob> {
  const response = await api.post<ApiResponse<SimilarQuestionJob>>('/similar-question-jobs', input);
  return response.data.data!;
}

export async function listSimilarQuestionJobs(): Promise<SimilarQuestionJob[]> {
  const response = await api.get<ApiResponse<SimilarQuestionJob[]>>('/similar-question-jobs');
  return response.data.data ?? [];
}

export async function getSimilarQuestionJob(id: number): Promise<SimilarQuestionJob> {
  const response = await api.get<ApiResponse<SimilarQuestionJob>>(`/similar-question-jobs/${id}`);
  return response.data.data!;
}

export async function retrySimilarQuestionJob(id: number): Promise<SimilarQuestionJob> {
  const response = await api.post<ApiResponse<SimilarQuestionJob>>(`/similar-question-jobs/${id}/retry`);
  return response.data.data!;
}

export async function saveSimilarQuestionResults(id: number, questionIds: number[]): Promise<SimilarQuestionJob> {
  const response = await api.post<ApiResponse<SimilarQuestionJob>>(`/similar-question-jobs/${id}/save`, { questionIds });
  return response.data.data!;
}
