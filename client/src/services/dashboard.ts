import type { ApiResponse, StudentDashboardData, TeacherDashboardData } from '@exam-maker/shared';
import api from './api';

export async function getTeacherDashboard(): Promise<TeacherDashboardData> {
  const response = await api.get<ApiResponse<TeacherDashboardData>>('/dashboard/teacher');
  return response.data.data!;
}

export async function getStudentDashboard(): Promise<StudentDashboardData> {
  const response = await api.get<ApiResponse<StudentDashboardData>>('/dashboard/student');
  return response.data.data!;
}
