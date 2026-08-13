import type { TeachingAnalytics } from '@exam-maker/shared';
import api from './api';
export async function getTeachingAnalytics(courseId: number): Promise<TeachingAnalytics> { return (await api.get(`/teaching-analytics/courses/${courseId}`)).data.data; }
export async function refreshTeachingAnalytics(courseId: number): Promise<TeachingAnalytics> { return (await api.post(`/teaching-analytics/courses/${courseId}/refresh`)).data.data; }
