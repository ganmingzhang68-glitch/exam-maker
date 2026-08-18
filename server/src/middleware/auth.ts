import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { UserRole } from '@exam-maker/shared';

// Resolve lazily because the application loads the root .env before it starts,
// while ESM dependencies are evaluated before the entry module body.
function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'exam-maker-secret-dev';
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: UserRole;
  requestId?: string;
  organizationId?: number;
  organizationExplicit?: boolean;
}

export function generateToken(userId: number, role: UserRole): string {
  const tokenVersion = db.select({ tokenVersion: schema.users.tokenVersion }).from(schema.users).where(eq(schema.users.id, userId)).get()?.tokenVersion ?? 0;
  return jwt.sign({ userId, role, tokenVersion }, getJwtSecret(), { expiresIn: '7d' });
}

export function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  // Try Authorization header first, then query param (for SSE)
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === 'string' && /^\/api\/projects\/\d+\/(?:events|download\/\d+)$/.test(req.path)) {
    token = req.query.token;
  }

  if (token) {
    try {
      const payload = jwt.verify(token, getJwtSecret()) as { userId: number; role: UserRole; tokenVersion?: number };
      const user = db.select({ id: schema.users.id, role: schema.users.role, isActive: schema.users.isActive, tokenVersion: schema.users.tokenVersion })
        .from(schema.users).where(eq(schema.users.id, payload.userId)).get();
      if (user?.isActive && user.tokenVersion === (payload.tokenVersion ?? 0)) { req.userId = user.id; req.userRole = user.role; }
    } catch {
      // Token invalid, continue without auth
    }
  }
  return next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }
  return next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ success: false, error: '权限不足' });
    }
    return next();
  };
}
