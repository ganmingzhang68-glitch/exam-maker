import type { AnswerContent, PracticeOptions, PracticeSession } from '@exam-maker/shared';
import api from './api';

export async function getPracticeOptions(): Promise<PracticeOptions> {
  return (await api.get('/practice/options')).data.data;
}
export async function listPracticeSessions(): Promise<PracticeSession[]> {
  return (await api.get('/practice/sessions')).data.data;
}
export async function createPracticeSession(input: { courseId: number; mode: 'wrong_questions' | 'knowledge_point' | 'weak_points'; knowledgePointId?: number; questionCount: number; difficulty?: 'basic' | 'medium' | 'hard' }): Promise<PracticeSession> {
  return (await api.post('/practice/sessions', input)).data.data;
}
export async function getPracticeSession(id: number): Promise<PracticeSession> {
  return (await api.get(`/practice/sessions/${id}`)).data.data;
}
export async function submitPracticeAnswer(sessionId: number, itemId: number, content: AnswerContent | null, timeSpentSeconds?: number): Promise<PracticeSession> {
  return (await api.put(`/practice/sessions/${sessionId}/items/${itemId}`, { content, timeSpentSeconds })).data.data;
}
