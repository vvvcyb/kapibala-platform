import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../types.js';

export const agentRunsRouter = Router();

// GET /api/agent-runs/:id -> query run with steps
agentRunsRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  try {
    const run = await prisma.agentRun.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!run) {
      next(new AppError(404, 'NOT_FOUND', `Agent run ${id} not found`));
      return;
    }

    res.status(200).json({
      id: run.id,
      groupId: run.groupId,
      status: run.status,
      endReason: run.endReason,
      summary: run.summary,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      steps: run.steps.map((s) => ({
        index: s.index,
        kind: s.kind,
        toolUseId: s.toolUseId,
        name: s.name,
        input: s.input,
        resultSummary: s.resultSummary,
        isError: s.isError,
        errorCode: s.errorCode,
        auditVerdict: s.auditVerdict,
        rawResponse: s.rawResponse,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});
