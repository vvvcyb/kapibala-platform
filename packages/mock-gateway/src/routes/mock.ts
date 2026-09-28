import { Router, Request, Response } from 'express';
import { gatewayStore } from '../store.js';
import { Group, GroupMember } from '../types.js';

export const mockControlRouter = Router();

// POST /mock/reset - Reset memory state to initial
mockControlRouter.post('/reset', (_req: Request, res: Response) => {
  gatewayStore.reset();
  res.json({ success: true, message: 'Gateway store reset to initial state' });
});

// POST /mock/accounts/:accountId/status - Set account status (triggers account_status & member_left)
mockControlRouter.post('/accounts/:accountId/status', (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { status } = req.body;

  if (status !== 'suspended' && status !== 'session_expired') {
    return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Status must be suspended or session_expired' } });
  }

  gatewayStore.setAccountStatus(accountId, status);
  return res.json({ success: true, accountId, status });
});

// POST /mock/accounts/:accountId/rate-limit
mockControlRouter.post('/accounts/:accountId/rate-limit', (req: Request, res: Response) => {
  const { accountId } = req.params;
  const retryAfterSeconds = Number(req.body.retryAfterSeconds ?? 5);

  gatewayStore.setAccountRateLimit(accountId, retryAfterSeconds);
  res.json({ success: true, accountId, retryAfterSeconds });
});

// POST /mock/groups/:groupId/write-forbidden
mockControlRouter.post('/groups/:groupId/write-forbidden', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { forbidden } = req.body;

  gatewayStore.setGroupWriteForbidden(groupId, Boolean(forbidden));
  res.json({ success: true, groupId, forbidden: Boolean(forbidden) });
});

// POST /mock/groups/:groupId/expire-invite
mockControlRouter.post('/groups/:groupId/expire-invite', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { inviteLink } = req.body;

  gatewayStore.expireInviteLink(groupId, inviteLink);
  res.json({ success: true, groupId, inviteLink });
});

// POST /mock/groups/:groupId/add-member - Simulate external member entering group
mockControlRouter.post('/groups/:groupId/add-member', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { platformUserId } = req.body;
  const group = gatewayStore.getGroup(groupId);
  if (group && platformUserId) {
    group.members.set(platformUserId, {
      platformUserId,
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
    gatewayStore.emitEvent('member_joined', { groupId, platformUserId });
  }
  res.json({ success: true, platformUserId });
});

// POST /mock/groups/:groupId/inbound-message - Simulate external member sending message (isOwn = false)
mockControlRouter.post('/groups/:groupId/inbound-message', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { senderPlatformUserId, text } = req.body;

  // 1. 检查 account_1, account_2, account_3，如果状态为 idle，调用 gatewayStore.connectAccount 将其上线
  const targetAccounts: Array<{ id: string; role: 'creator' | 'admin' | 'member' }> = [
    { id: 'account_1', role: 'creator' },
    { id: 'account_2', role: 'admin' },
    { id: 'account_3', role: 'member' },
  ];

  for (const item of targetAccounts) {
    const acc = gatewayStore.getAccount(item.id);
    if (!acc || acc.status === 'idle') {
      try {
        gatewayStore.connectAccount(item.id);
      } catch {}
    }
  }

  // 2. 如果 !gatewayStore.getGroup(groupId)，直接在 gatewayStore 的 groups 映射中为该 groupId 注册初始群对象
  if (!gatewayStore.getGroup(groupId)) {
    const members = new Map<string, GroupMember>();
    for (const item of targetAccounts) {
      const acc = gatewayStore.getAccount(item.id);
      const platformUserId = acc?.platformUserId || `u_${item.id}`;
      members.set(platformUserId, {
        platformUserId,
        accountId: item.id,
        role: item.role,
        joinedAt: new Date().toISOString(),
      });
    }

    const group: Group = {
      groupId,
      creatorAccountId: 'account_1',
      members,
      inviteLinks: new Map(),
      messages: [],
      writeForbidden: false,
      ownerLeft: false,
    };

    gatewayStore.groups.set(groupId, group);
  }

  // 3. 随后正常 emit 消息事件
  const msgId = `m_ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const sentAt = new Date().toISOString();

  gatewayStore.emitEvent('message', {
    groupId,
    msgId,
    senderPlatformUserId: senderPlatformUserId || 'u_external_visitor',
    text: text || 'Hello from external user',
    sentAt,
  });

  res.json({ success: true, msgId, sentAt });
});

// POST /mock/config - Update simulation options
mockControlRouter.post('/config', (req: Request, res: Response) => {
  const { duplicateEvents, defaultSendDelayMs, defaultJoinDelayMs } = req.body;

  if (duplicateEvents !== undefined) {
    gatewayStore.simulation.duplicateEvents = Boolean(duplicateEvents);
  }
  if (defaultSendDelayMs !== undefined) {
    gatewayStore.simulation.defaultSendDelayMs = Number(defaultSendDelayMs);
  }
  if (defaultJoinDelayMs !== undefined) {
    gatewayStore.simulation.defaultJoinDelayMs = Number(defaultJoinDelayMs);
  }

  res.json({ success: true, simulation: gatewayStore.simulation });
});

// GET /mock/state - Inspection endpoint for testing
mockControlRouter.get('/state', (_req: Request, res: Response) => {
  res.json({
    accounts: gatewayStore.getAllAccounts(),
    simulation: gatewayStore.simulation,
  });
});
