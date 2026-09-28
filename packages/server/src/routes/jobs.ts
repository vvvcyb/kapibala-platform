import { Router, Request, Response, NextFunction } from 'express';
import { groupService } from '../services/group.service.js';
import { authenticate } from '../middleware/auth.js';

export const jobsRouter = Router();

// GET /api/jobs/:jobId -> { status: running | finished | failed, errors: [{ step, code }] }
jobsRouter.get('/:jobId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { jobId } = req.params;
  try {
    const job = await groupService.getJobById(jobId);
    res.status(200).json(job);
  } catch (err) {
    next(err);
  }
});
