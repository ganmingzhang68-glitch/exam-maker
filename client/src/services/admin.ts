import type { AdminDashboard, User, UserRole } from '@exam-maker/shared'; import api from './api';
export async function getAdminDashboard(): Promise<AdminDashboard> { return (await api.get('/admin/dashboard')).data.data; }
export async function listAdminUsers(params?: { search?: string; role?: UserRole; active?: string }): Promise<User[]> { return (await api.get('/admin/users', { params })).data.data; }
export async function createAdminUser(input: { username: string; email: string; password: string; role: UserRole }): Promise<User> { return (await api.post('/admin/users', input)).data.data; }
export async function updateAdminUser(id: number, input: { role?: UserRole; isActive?: boolean; resetLoginState?: boolean }): Promise<User> { return (await api.patch(`/admin/users/${id}`, input)).data.data; }
export async function listAdminAuditLogs(): Promise<Array<Record<string, unknown>>> { return (await api.get('/admin/audit-logs')).data.data; }
export async function listAiCostConfigs(): Promise<Array<Record<string, unknown>>> { return (await api.get('/admin/ai-cost-configs')).data.data; }
export async function createAiCostConfig(input: Record<string, unknown>): Promise<Record<string, unknown>> { return (await api.post('/admin/ai-cost-configs', input)).data.data; }
