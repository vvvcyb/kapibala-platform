import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { config } from '../config.js';
import { AppError } from '../types.js';

export const authRouter = Router();

// POST /api/auth/login { username, password } -> { accessToken }
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  const { username, password } = req.body;

  if (!username || !password) {
    next(new AppError(400, 'VALIDATION_ERROR', 'username and password are required'));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || user.password !== password) {
      next(new AppError(401, 'UNAUTHORIZED', 'Invalid username or password'));
      return;
    }

    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role as 'admin' | 'viewer',
    };

    const accessToken = jwt.sign(payload, config.jwtSecret, {
      expiresIn: '15m',
    });

    res.status(200).json({ accessToken });
  } catch (err) {
    next(err);
  }
});
