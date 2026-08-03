import type {
  ApiResponse,
  DifficultyLevel,
  Question,
  QuestionListItem,
  QuestionSource,
  QuestionStatus,
  QuestionType,
} from '@exam-maker/shared';
import api from './api';

export interface QuestionFilters {
  status?: QuestionStatus;
  type?: QuestionType;
  difficulty?: DifficultyLevel;
  sourceFileId?: number;
  sourceProjectId?: number;
  limit?: number;
  offset?: number;
}

export async function listQuestions(filters: QuestionFilters = {}): Promise<QuestionListItem[]> {
  const response = await api.get<ApiResponse<QuestionListItem[]>>('/questions', { params: filters });
  return response.data.data ?? [];
}

export async function listQuestionSources(): Promise<QuestionSource[]> {
  const response = await api.get<ApiResponse<QuestionSource[]>>('/questions/sources');
  return response.data.data ?? [];
}

export async function getQuestion(id: number): Promise<Question> {
  const response = await api.get<ApiResponse<Question>>(`/questions/${id}`);
  return response.data.data!;
}

export async function updateQuestion(id: number, values: Partial<Question>): Promise<Question> {
  const response = await api.patch<ApiResponse<Question>>(`/questions/${id}`, values);
  return response.data.data!;
}

export async function reviewQuestion(
  id: number,
  status: Extract<QuestionStatus, 'reviewed' | 'rejected'>,
): Promise<Question> {
  const response = await api.patch<ApiResponse<Question>>(`/questions/${id}/review`, { status });
  return response.data.data!;
}

export async function deleteQuestion(id: number): Promise<void> {
  await api.delete(`/questions/${id}`);
}
