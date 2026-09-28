import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AuthUser, AppError } from '../types.js';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = payload;
    next();
  } catch (_err) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Token is invalid or expired'));
  }
}

export function requireWritePermission(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'viewer') {
    return next(new AppError(403, 'FORBIDDEN', 'Viewer has read-only access and cannot perform write operations'));
  }
  next();
}
