import api from './api';
import type {
  ApiResponse, Project, ProjectDetail, CreateProjectRequest,
} from '@exam-maker/shared';

export async function listProjects(): Promise<Project[]> {
  const res = await api.get<ApiResponse<Project[]>>('/projects');
  return res.data.data!;
}

export async function getProject(id: number): Promise<ProjectDetail> {
  const res = await api.get<ApiResponse<ProjectDetail>>(`/projects/${id}`);
  return res.data.data!;
}

export async function createProject(data: CreateProjectRequest): Promise<Project> {
  const res = await api.post<ApiResponse<Project>>('/projects', data);
  return res.data.data!;
}

export async function deleteProject(id: number): Promise<void> {
  await api.delete(`/projects/${id}`);
}

export async function uploadPapers(projectId: number, files: File[]): Promise<void> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  await api.post(`/projects/${projectId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function approveCheckpoint(
  projectId: number,
  step: string,
  action: 'approve' | 'reject',
  notes?: string
): Promise<void> {
  await api.post(`/projects/${projectId}/checkpoints/${step}`, { action, notes });
}

export async function startWorkflow(projectId: number): Promise<void> {
  await api.post(`/projects/${projectId}/start`);
}

export function getEventsUrl(projectId: number): string {
  return `/api/projects/${projectId}/events`;
}
