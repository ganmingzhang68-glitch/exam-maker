import { Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { AuthRequest } from './auth.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: AuthRequest, res: Response, _next: NextFunction) {
  const requestId = req.requestId ?? 'untracked';
  console.error(`[Error] request_id=${requestId} ${err.message}`);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      requestId,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: err.issues[0]?.message ?? '请求参数不合法',
      details: err.flatten(),
      requestId,
    });
  }

  return res.status(500).json({
    success: false,
    error: '服务器内部错误',
    requestId,
  });
}
