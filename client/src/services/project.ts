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

export async function getEnvironment(): Promise<{ env: Record<string, unknown>; report: string }> {
  const res = await api.get('/projects/env');
  return res.data.data;
}

export interface BlueprintResponse {
  entries: Array<{
    src: string; no: string; type: string; points: number;
    kp: string[]; difficulty: string; cognition: string; stem_kind: string; note?: string;
  }>;
  markdown: string;
}

export async function getBlueprint(projectId: number): Promise<BlueprintResponse | null> {
  const res = await api.get<{ success: boolean; data: BlueprintResponse | null }>(`/projects/${projectId}/blueprint`);
  return res.data.data;
}

export interface TemplateResponse {
  template: {
    course: string; totalScore: number; duration: number;
    sections: Array<{ index: number; type: string; count: number; pointsPerQuestion: number; subtotal: number }>;
    verified: boolean; verifyNotes: string[];
  };
  markdown: string;
}

export async function getTemplateData(projectId: number): Promise<TemplateResponse | null> {
  const res = await api.get<{ success: boolean; data: TemplateResponse | null }>(`/projects/${projectId}/template`);
  return res.data.data;
}

export interface BlueprintData {
  entries: Array<{
    src: string; no: string; type: string; points: number;
    kp: string[]; difficulty: string; cognition: string; stem_kind: string; note?: string;
  }>;
  kpList: Array<{
    id: string; name: string; description: string;
    frequency: number; totalPoints: number; isRequired: boolean;
  }>;
  matrix: {
    headers: string[]; columnTotals: number[];
    rows: Array<{
      kpId: string; kpName: string; basic: number; medium: number;
      hard: number; total: number; frequency: number; isRequired: boolean;
    }>;
  };
  difficultySummary: Record<string, { target: number; actual: number; passed: boolean }>;
  verified: boolean;
  verifyNotes: string[];
}

export function getEventsUrl(projectId: number): string {
  return `/api/projects/${projectId}/events`;
}
