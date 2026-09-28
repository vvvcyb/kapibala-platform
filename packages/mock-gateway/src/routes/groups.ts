import { Router, Request, Response } from 'express';
import { gatewayStore } from '../store.js';

export const groupsRouter = Router();

// POST /groups { creatorAccountId } -> { groupId }
groupsRouter.post('/', (req: Request, res: Response) => {
  const { creatorAccountId } = req.body;
  if (!creatorAccountId) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'creatorAccountId is required' } });
  }

  try {
    const result = gatewayStore.createGroup(creatorAccountId);
    return res.status(200).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// POST /groups/:groupId/invite -> { inviteLink, readyAfterMs }
groupsRouter.post('/:groupId/invite', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const readyAfterMs = Number(req.body?.readyAfterMs ?? req.query?.readyAfterMs ?? 0);

  try {
    const result = gatewayStore.createInvite(groupId, readyAfterMs);
    return res.status(200).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// POST /groups/:groupId/join { accountId, inviteLink } -> 202 { accepted: true }
groupsRouter.post('/:groupId/join', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { accountId, inviteLink } = req.body;

  if (!accountId || !inviteLink) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'accountId and inviteLink are required' },
    });
  }

  try {
    const result = gatewayStore.joinGroup(groupId, accountId, inviteLink);
    return res.status(202).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// POST /groups/:groupId/promote { byAccountId, accountId } -> 200 {}
groupsRouter.post('/:groupId/promote', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { byAccountId, accountId } = req.body;

  if (!byAccountId || !accountId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'byAccountId and accountId are required' },
    });
  }

  try {
    gatewayStore.promoteMember(groupId, byAccountId, accountId);
    return res.status(200).json({});
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// POST /groups/:groupId/kick { byAccountId, targetPlatformUserId } -> 200 { kicked: true }
groupsRouter.post('/:groupId/kick', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { byAccountId, targetPlatformUserId } = req.body;

  // Simulation header override
  const mockStatus = req.headers['x-mock-status'];
  if (mockStatus === '504' || mockStatus === 'NETWORK_TIMEOUT') {
    return res.status(504).json({ error: { code: 'NETWORK_TIMEOUT', message: 'Gateway timeout' } });
  }

  if (!byAccountId || !targetPlatformUserId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'byAccountId and targetPlatformUserId are required' },
    });
  }

  try {
    const result = gatewayStore.kickMember(groupId, byAccountId, targetPlatformUserId);
    return res.status(200).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// POST /groups/:groupId/leave { accountId } -> 200
groupsRouter.post('/:groupId/leave', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { accountId } = req.body;

  // Simulation header override (SPEC 2.1: leave 也可能返回 500（没退成）)
  const mockStatus = req.headers['x-mock-status'];
  if (mockStatus === '500') {
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to leave group' } });
  }

  if (!accountId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'accountId is required' },
    });
  }

  try {
    gatewayStore.leaveGroup(groupId, accountId);
    return res.status(200).json({});
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});

// GET /groups/:groupId/members -> [{ platformUserId }]
groupsRouter.get('/:groupId/members', (req: Request, res: Response) => {
  const { groupId } = req.params;

  try {
    const members = gatewayStore.getMembers(groupId);
    return res.status(200).json(members);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    const statusCode = errorObj.status || 500;
    return res.status(statusCode).json({
      error: { code: errorObj.code || 'INTERNAL_ERROR', message: errorObj.message },
    });
  }
});
