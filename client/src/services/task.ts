import type { ApiResponse, TaskDetail, TaskKind, TaskStatus, TaskSummary } from '@exam-maker/shared';
import api from './api';

export async function listTasks(status?: TaskStatus): Promise<TaskSummary[]> {
  const response = await api.get<ApiResponse<TaskSummary[]>>('/tasks', { params: status ? { status } : undefined });
  return response.data.data!;
}

export async function getTask(kind: TaskKind, id: number): Promise<TaskDetail> {
  const response = await api.get<ApiResponse<TaskDetail>>(`/tasks/${kind}/${id}`);
  return response.data.data!;
}

export async function cancelTask(kind: TaskKind, id: number): Promise<TaskDetail> {
  const response = await api.post<ApiResponse<TaskDetail>>(`/tasks/${kind}/${id}/cancel`);
  return response.data.data!;
}

export async function retryTask(kind: TaskKind, id: number): Promise<TaskDetail> {
  const response = await api.post<ApiResponse<TaskDetail>>(`/tasks/${kind}/${id}/retry`);
  return response.data.data!;
}
