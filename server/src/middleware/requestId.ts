import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './auth.js';

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const supplied = req.header('X-Request-Id');
  req.requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
