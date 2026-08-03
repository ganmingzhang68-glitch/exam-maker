import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { UserRole } from '@exam-maker/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'exam-maker-secret-dev';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: UserRole;
}

export function generateToken(userId: number, role: UserRole): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });
}

export function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  // Try Authorization header first, then query param (for SSE)
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: number; role: UserRole };
      req.userId = payload.userId;
      req.userRole = payload.role;
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
