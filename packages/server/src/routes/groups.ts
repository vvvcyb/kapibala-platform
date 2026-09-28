import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma.js';
import { groupService } from '../services/group.service.js';
import { messageService } from '../services/message.service.js';
import { websocketService } from '../services/websocket.service.js';
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

// PATCH /api/groups/:id & PATCH /api/groups/:id/settings
const updateSettingsHandler = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { agentEnabled, autoKickEnabled } = req.body;
  try {
    const updated = await groupService.updateGroupConfig(id, { agentEnabled, autoKickEnabled });
    websocketService.notifyGroupUpdated(updated);
    res.status(200).json({ success: true, group: updated });
  } catch (err) {
    next(err);
  }
};

groupsRouter.patch('/:id/settings', authenticate, requireWritePermission, updateSettingsHandler);
groupsRouter.patch('/:id', authenticate, requireWritePermission, updateSettingsHandler);

// GET /api/groups/:id/agent-runs -> list recent agent runs for this group
groupsRouter.get('/:id/agent-runs', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  try {
    const runs = await prisma.agentRun.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.status(200).json(runs);
  } catch (err) {
    next(err);
  }
});

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

// GET /api/groups/:id/messages?cursor=<msgId>&limit=20
groupsRouter.get('/:id/messages', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  const { id: groupId } = req.params;
  const cursorParam = (req.query.cursor || req.query.before) as string | undefined;
  const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

  try {
    const result = await messageService.getMessages(groupId, cursorParam, limitParam);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
