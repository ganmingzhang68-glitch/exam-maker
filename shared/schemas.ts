import { z } from 'zod';

// ============ Auth ============
export const loginSchema = z.object({
  username: z.string().min(2, '用户名至少2个字符'),
  password: z.string().min(6, '密码至少6个字符'),
});

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email('请输入有效的邮箱'),
  password: z.string().min(6, '密码至少6个字符'),
});

// ============ Project ============
export const difficultyRatioSchema = z.object({
  basic: z.number().min(0).max(100),
  medium: z.number().min(0).max(100),
  hard: z.number().min(0).max(100),
}).refine(d => d.basic + d.medium + d.hard === 100, '难度比例之和必须为100%');

export const createProjectSchema = z.object({
  title: z.string().min(1, '项目名称不能为空'),
  course: z.string().min(1, '课程名不能为空'),
  scope: z.string().optional(),
  difficulty: difficultyRatioSchema.default({ basic: 60, medium: 30, hard: 10 }),
  nSets: z.number().int().min(1).max(50).default(8),
  outputType: z.enum(['latex', 'docx', 'md']).default('latex'),
  verifyMode: z.enum(['auto', 'computational', 'conceptual', 'mixed']).default('auto'),
});

// ============ Checkpoint ============
export const checkpointActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
});
