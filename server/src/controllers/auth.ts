import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { db, schema } from '../db/index.js';
import { eq, or } from 'drizzle-orm';
import { loginSchema, registerSchema } from '@exam-maker/shared';
import { generateToken, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = registerSchema.parse(req.body);

    // Check if username or email already exists
    const existing = db
      .select()
      .from(schema.users)
      .where(
        or(eq(schema.users.username, data.username), eq(schema.users.email, data.email))
      )
      .get();

    if (existing) {
      if (existing.username === data.username) {
        throw new AppError(400, '用户名已被占用');
      }
      throw new AppError(400, '邮箱已被注册');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const result = db
      .insert(schema.users)
      .values({
        username: data.username,
        email: data.email,
        passwordHash,
        role: 'student',
      })
      .returning()
      .get();

    const token = generateToken(result.id, result.role);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: result.id,
          username: result.username,
          email: result.email,
          role: result.role,
          createdAt: result.createdAt,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = loginSchema.parse(req.body);

    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, data.username))
      .get();

    if (!user) {
      throw new AppError(401, '用户名或密码错误');
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, '用户名或密码错误');
    }

    const token = generateToken(user.id, user.role);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.userId) {
      throw new AppError(401, '请先登录');
    }

    const user = db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId))
      .get();

    if (!user) {
      throw new AppError(404, '用户不存在');
    }

    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}
