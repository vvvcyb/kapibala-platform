import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    let code = err.code;
    if (err.statusCode === 401) code = 'UNAUTHORIZED';
    if (err.statusCode === 403) code = 'FORBIDDEN';

    res.status(err.statusCode).json({
      error: {
        code,
        message: err.message,
        requestId,
        ...(err.details || {}),
      },
    });
    return;
  }

  // Handle unexpected or generic errors
  console.error('[Unhandled Error]:', err);
  const errorObj = err as { statusCode?: number; code?: string; message?: string };
  const statusCode = errorObj.statusCode || 500;
  let code = errorObj.code || 'INTERNAL_SERVER_ERROR';
  if (statusCode === 401) code = 'UNAUTHORIZED';
  if (statusCode === 403) code = 'FORBIDDEN';

  res.status(statusCode).json({
    error: {
      code,
      message: errorObj.message || 'An unexpected internal error occurred',
      requestId,
    },
  });
}
