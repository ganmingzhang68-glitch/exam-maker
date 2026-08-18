import type { Organization } from '@exam-maker/shared'; import api from './api';
export async function listOrganizations(): Promise<Organization[]> { return (await api.get('/organizations/mine')).data.data; }
export async function createOrganization(input: { name: string; code: string }): Promise<Organization> { return (await api.post('/organizations', input)).data.data; }
export async function addOrganizationMember(id: number, input: { userId: number; role: 'owner' | 'admin' | 'member'; isDefault: boolean }) { return (await api.post(`/organizations/${id}/members`, input)).data.data; }
