import { Router, Request, Response } from 'express';

export const healthRouter = Router();

// GET /api/health -> { ok, schemaVersion }
healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, schemaVersion: '1.0.0' });
});
