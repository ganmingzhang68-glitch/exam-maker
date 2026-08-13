import type { ApiResponse, StudentLearningOverview, TeacherCourseKnowledgeAnalytics } from '@exam-maker/shared';
import api from './api';

export async function getMyLearning(): Promise<StudentLearningOverview> {
  const response = await api.get<ApiResponse<StudentLearningOverview>>('/learning/student');
  return response.data.data!;
}

export async function getCourseKnowledgeAnalytics(courseId: number): Promise<TeacherCourseKnowledgeAnalytics> {
  const response = await api.get<ApiResponse<TeacherCourseKnowledgeAnalytics>>(`/learning/courses/${courseId}`);
  return response.data.data!;
}
