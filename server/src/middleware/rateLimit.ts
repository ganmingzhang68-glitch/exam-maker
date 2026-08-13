import type { NextFunction, Response } from 'express'; import type { AuthRequest } from './auth.js';
interface Bucket { count: number; resetAt: number }
export function createRateLimit(options: { windowMs: number; max: number; name: string }) { const buckets = new Map<string, Bucket>(); return (req: AuthRequest, res: Response, next: NextFunction) => { const now = Date.now(); const identity = req.userId ? `u:${req.userId}` : `ip:${req.ip ?? 'unknown'}`; const key = `${options.name}:${identity}`; let bucket = buckets.get(key); if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + options.windowMs }; buckets.set(key, bucket); } bucket.count += 1; res.setHeader('X-RateLimit-Limit', options.max); res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - bucket.count)); res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000)); if (bucket.count > options.max) return res.status(429).json({ success: false, error: '请求过于频繁，请稍后重试', requestId: req.requestId ?? 'untracked' }); return next(); }; }
export const loginRateLimit = createRateLimit({ windowMs: 15 * 60_000, max: 10, name: 'login' });
export const uploadRateLimit = createRateLimit({ windowMs: 60 * 60_000, max: 20, name: 'upload' });
export const aiGenerationRateLimit = createRateLimit({ windowMs: 60 * 60_000, max: 30, name: 'ai-generation' });
export const aiGradingRateLimit = createRateLimit({ windowMs: 60 * 60_000, max: 100, name: 'ai-grading' });
export const exportRateLimit = createRateLimit({ windowMs: 15 * 60_000, max: 50, name: 'export' });
