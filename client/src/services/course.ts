import type { ApiResponse, CourseDetail, CourseDifficultyCalibration, CourseStatus } from '@exam-maker/shared';
import api from './api';

export interface CourseInput {
  name: string;
  code?: string | null;
  semester?: string | null;
  description?: string | null;
  instructorName?: string | null;
  status?: CourseStatus;
}

export async function listCourses(params?: { status?: CourseStatus; search?: string }): Promise<CourseDetail[]> {
  const response = await api.get<ApiResponse<CourseDetail[]>>('/courses', { params });
  return response.data.data ?? [];
}

export async function getCourse(id: number): Promise<CourseDetail> {
  const response = await api.get<ApiResponse<CourseDetail>>(`/courses/${id}`);
  return response.data.data!;
}

export async function getCourseDifficultyCalibration(id: number): Promise<CourseDifficultyCalibration> {
  const response = await api.get<ApiResponse<CourseDifficultyCalibration>>(`/courses/${id}/difficulty-calibration`);
  return response.data.data!;
}

export async function createCourse(input: CourseInput): Promise<CourseDetail> {
  const response = await api.post<ApiResponse<CourseDetail>>('/courses', input);
  return response.data.data!;
}

export async function updateCourse(id: number, input: Partial<CourseInput>): Promise<CourseDetail> {
  const response = await api.patch<ApiResponse<CourseDetail>>(`/courses/${id}`, input);
  return response.data.data!;
}

export async function archiveCourse(id: number): Promise<CourseDetail> {
  const response = await api.delete<ApiResponse<CourseDetail>>(`/courses/${id}`);
  return response.data.data!;
}
