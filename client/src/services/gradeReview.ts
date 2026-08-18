import type { GradeReview } from '@exam-maker/shared'; import api from './api';
export async function createGradeReview(input: { attemptId: number; answerId?: number | null; reason: string; evidence?: string | null }): Promise<GradeReview> { return (await api.post('/grade-reviews', input)).data.data; }
export async function listMyGradeReviews(): Promise<GradeReview[]> { return (await api.get('/grade-reviews/mine')).data.data; }
export async function listGradeReviews(examId?: number): Promise<GradeReview[]> { return (await api.get('/grade-reviews', { params: { examId } })).data.data; }
export async function resolveGradeReview(id: number, input: { decision: 'accepted' | 'rejected'; resolution: string; adjustedScore?: number | null }): Promise<GradeReview> { return (await api.patch(`/grade-reviews/${id}/resolve`, input)).data.data; }
