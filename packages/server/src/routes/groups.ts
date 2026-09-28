import { Router, Request, Response, NextFunction } from 'express';
import { groupService } from '../services/group.service.js';
import { messageService } from '../services/message.service.js';
import { authenticate, requireWritePermission } from '../middleware/auth.js';
import { AppError } from '../types.js';

export const groupsRouter = Router();

// POST /api/groups { creatorAccountId, memberAccountIds[] } -> 202 { jobId }
groupsRouter.post(
  '/',
  authenticate,
  requireWritePermission,
  async (req: Request, res: Response, next: NextFunction) => {
    const { creatorAccountId, memberAccountIds } = req.body;
    try {
      const jobId = await groupService.startCreateGroupJob(creatorAccountId, memberAccountIds);
      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/groups -> [{ id, gatewayGroupId, status, creatorAccountId, ... }]
groupsRouter.get('/', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await groupService.getGroups();
    res.status(200).json(groups);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id -> { id, gatewayGroupId, status, creatorAccountId, ... }
groupsRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  try {
    const group = await groupService.getGroupById(id);
    res.status(200).json(group);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/groups/:id { agentEnabled?, autoKickEnabled? } -> 200
groupsRouter.patch(
  '/:id',
  authenticate,
  requireWritePermission,
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { agentEnabled, autoKickEnabled } = req.body;
    try {
      await groupService.updateGroupConfig(id, { agentEnabled, autoKickEnabled });
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/groups/:id/send { accountId, text } -> 202 { clientMsgId }
groupsRouter.post(
  '/:id/send',
  authenticate,
  requireWritePermission,
  async (req: Request, res: Response, next: NextFunction) => {
    const { id: groupId } = req.params;
    const { accountId, text } = req.body;

    if (!accountId || typeof text !== 'string') {
      next(new AppError(400, 'VALIDATION_ERROR', 'accountId and text are required'));
      return;
    }

    try {
      const result = await messageService.sendGroupMessage(groupId, accountId, text);
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/groups/:id/messages?before=<cursor>&limit=50 -> { items: [...], nextCursor }
groupsRouter.get('/:id/messages', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { id: groupId } = req.params;
  const before = req.query.before as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  try {
    const result = await messageService.getMessages(groupId, before, limit);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
