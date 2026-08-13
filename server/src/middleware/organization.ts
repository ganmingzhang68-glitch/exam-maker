import type { NextFunction, Response } from 'express'; import { and, eq } from 'drizzle-orm'; import { db, schema } from '../db/index.js'; import type { AuthRequest } from './auth.js';
export function organizationMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) return next();
  const raw = req.headers['x-organization-id'];
  if (raw !== undefined && (Array.isArray(raw) || !/^\d+$/.test(raw))) return res.status(400).json({ success: false, error: 'x-organization-id 必须是正整数' });
  const explicit = typeof raw === 'string';
  const memberships = db.select().from(schema.userOrganizations)
    .where(eq(schema.userOrganizations.userId, req.userId)).all();
  const implicitMembership = memberships.find(item => item.isDefault) ?? memberships[0];
  if (!explicit && req.userRole !== 'admin' && !implicitMembership) {
    return res.status(403).json({ success: false, error: '账号尚未加入任何组织' });
  }
  const organizationId = explicit ? Number(raw) : implicitMembership?.organizationId ?? 1;
  const organization = db.select().from(schema.organizations).where(and(eq(schema.organizations.id, organizationId), eq(schema.organizations.status, 'active'))).get();
  if (!organization) return res.status(403).json({ success: false, error: '组织不存在或已停用' });
  if (req.userRole !== 'admin') {
    const member = memberships.find(item => item.organizationId === organizationId);
    if (!member) return res.status(403).json({ success: false, error: '无权访问该组织' });
  }
  req.organizationId = organizationId; req.organizationExplicit = explicit; return next();
}
export function canAccessOrganization(req: AuthRequest, organizationId: number): boolean { if (!req.organizationId) return true; return req.userRole === 'admin' && !req.organizationExplicit ? true : req.organizationId === organizationId; }
