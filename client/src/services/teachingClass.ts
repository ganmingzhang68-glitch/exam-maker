import type {
  ApiResponse, EnrollmentImportResult, StudentSearchResult,
  TeachingClass, TeachingClassDetail, TeachingClassStatus,
} from '@exam-maker/shared';
import api from './api';

export interface TeachingClassInput {
  courseId: number;
  name: string;
  semester?: string | null;
  status?: TeachingClassStatus;
}

export async function listTeachingClasses(params?: { courseId?: number; status?: TeachingClassStatus; search?: string }): Promise<TeachingClass[]> {
  const response = await api.get<ApiResponse<TeachingClass[]>>('/classes', { params });
  return response.data.data ?? [];
}

export async function getTeachingClass(id: number): Promise<TeachingClassDetail> {
  const response = await api.get<ApiResponse<TeachingClassDetail>>(`/classes/${id}`);
  return response.data.data!;
}

export async function createTeachingClass(input: TeachingClassInput): Promise<TeachingClassDetail> {
  const response = await api.post<ApiResponse<TeachingClassDetail>>('/classes', input);
  return response.data.data!;
}

export async function updateTeachingClass(id: number, input: Partial<Omit<TeachingClassInput, 'courseId'>>): Promise<TeachingClassDetail> {
  const response = await api.patch<ApiResponse<TeachingClassDetail>>(`/classes/${id}`, input);
  return response.data.data!;
}

export async function archiveTeachingClass(id: number): Promise<void> { await api.delete(`/classes/${id}`); }

export async function searchClassStudents(classId: number, q: string): Promise<StudentSearchResult[]> {
  const response = await api.get<ApiResponse<StudentSearchResult[]>>(`/classes/${classId}/students/search`, { params: { q, limit: 50 } });
  return response.data.data ?? [];
}

export async function addClassStudents(classId: number, studentIds: number[]): Promise<EnrollmentImportResult> {
  const response = await api.post<ApiResponse<EnrollmentImportResult>>(`/classes/${classId}/enrollments`, { studentIds });
  return response.data.data!;
}

export async function importClassStudents(classId: number, studentIdentifiers: string[]): Promise<EnrollmentImportResult> {
  const response = await api.post<ApiResponse<EnrollmentImportResult>>(`/classes/${classId}/enrollments/import`, { studentIdentifiers });
  return response.data.data!;
}

export async function removeClassStudent(classId: number, studentId: number): Promise<void> {
  await api.delete(`/classes/${classId}/enrollments/${studentId}`);
}
