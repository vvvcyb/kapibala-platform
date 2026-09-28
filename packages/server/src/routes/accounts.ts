import { Router, Request, Response, NextFunction } from 'express';
import { AccountStatus } from '@prisma/client';
import { accountService } from '../services/account.service.js';
import { authenticate, requireWritePermission } from '../middleware/auth.js';
import { AppError } from '../types.js';

export const accountsRouter = Router();

// GET /api/accounts -> [{ id, status, platformUserId, rateLimitedUntil }]
accountsRouter.get('/', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await accountService.getAllAccounts();
    res.status(200).json(accounts);
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts/:id/connect -> 200 { status, platformUserId }
accountsRouter.post(
  '/:id/connect',
  authenticate,
  requireWritePermission,
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    try {
      const result = await accountService.connectAccount(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/accounts/:id/transition { to, expectedFrom } -> 200 { status }
accountsRouter.post(
  '/:id/transition',
  authenticate,
  requireWritePermission,
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { to, expectedFrom } = req.body;

    if (!to || !expectedFrom) {
      next(new AppError(400, 'VALIDATION_ERROR', 'Both "to" and "expectedFrom" are required'));
      return;
    }

    try {
      const result = await accountService.transitionAccount(
        id,
        expectedFrom as AccountStatus,
        to as AccountStatus
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
