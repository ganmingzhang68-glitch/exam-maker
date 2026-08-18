import type {
  ApiResponse,
  DifficultyLevel,
  Question,
  QuestionDetail,
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
  courseId?: number;
  origin?: Question['origin'];
  lifecycleStatus?: Question['lifecycleStatus'];
  search?: string;
  knowledgePoint?: string;
  usage?: 'used' | 'unused';
  sort?: 'updated_desc' | 'updated_asc' | 'score_desc' | 'score_asc';
}

export async function listQuestions(filters: QuestionFilters = {}): Promise<QuestionListItem[]> {
  const response = await api.get<ApiResponse<QuestionListItem[]>>('/questions', { params: filters });
  return response.data.data ?? [];
}

export async function listQuestionSources(): Promise<QuestionSource[]> {
  const response = await api.get<ApiResponse<QuestionSource[]>>('/questions/sources');
  return response.data.data ?? [];
}

export async function getQuestion(id: number): Promise<QuestionDetail> {
  const response = await api.get<ApiResponse<QuestionDetail>>(`/questions/${id}`);
  return response.data.data!;
}

export async function copyQuestion(id: number): Promise<Question> {
  const response = await api.post<ApiResponse<Question>>(`/questions/${id}/copy`);
  return response.data.data!;
}

export async function bulkQuestionAction(questionIds: number[], action: 'archive' | 'approve'): Promise<number> {
  const response = await api.patch<ApiResponse<{ updated: number }>>('/questions/bulk', { questionIds, action });
  return response.data.data?.updated ?? 0;
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
