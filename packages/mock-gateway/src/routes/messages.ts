import { Router, Request, Response } from 'express';
import { gatewayStore } from '../store.js';

export const messagesRouter = Router();

// POST /groups/:groupId/send { accountId, clientMsgId, text } -> 202 { accepted: true }
messagesRouter.post('/:groupId/send', (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { accountId, clientMsgId, text } = req.body;

  // Header or query-based simulation override
  const mockStatus = (req.headers['x-mock-status'] || req.query.simStatus) as string | undefined;

  if (mockStatus === '503') {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Gateway temporarily unavailable' } });
  }

  if (mockStatus === '429' || mockStatus === 'RATE_LIMITED') {
    const retryAfter = Number(req.headers['x-retry-after'] || 5);
    gatewayStore.setAccountRateLimit(accountId, retryAfter);
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Rate limited', retryAfterSeconds: retryAfter },
    });
  }

  if (mockStatus === '504' || mockStatus === 'NETWORK_TIMEOUT') {
    // S5 simulation: If requested, drop synchronous response with 504,
    // but asynchronously land message after 1.5s and emit message_sent + message!
    const shouldDeliverAsync = req.headers['x-mock-async-deliver'] !== 'false';
    if (shouldDeliverAsync) {
      setTimeout(() => {
        try {
          gatewayStore.sendMessage(groupId, accountId, clientMsgId, text);
        } catch (err) {
          console.error('Async delivery failed:', err);
        }
      }, 1500);
    }
    return res.status(504).json({ error: { code: 'NETWORK_TIMEOUT', message: 'Gateway timeout' } });
  }

  if (mockStatus === 'GROUP_WRITE_FORBIDDEN') {
    return res.status(403).json({ error: { code: 'GROUP_WRITE_FORBIDDEN', message: 'Group write forbidden' } });
  }

  if (mockStatus === 'ACCOUNT_SUSPENDED') {
    return res.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' } });
  }

  if (mockStatus === 'SESSION_EXPIRED') {
    return res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
  }

  if (!accountId || !clientMsgId || typeof text !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'accountId, clientMsgId, and text are required' },
    });
  }

  try {
    const result = gatewayStore.sendMessage(groupId, accountId, clientMsgId, text);
    return res.status(202).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string; retryAfterSeconds?: number };
    const statusCode = errorObj.status || 500;
    const body: Record<string, unknown> = {
      error: {
        code: errorObj.code || 'INTERNAL_ERROR',
        message: errorObj.message,
      },
    };
    if (errorObj.retryAfterSeconds !== undefined) {
      (body.error as Record<string, unknown>).retryAfterSeconds = errorObj.retryAfterSeconds;
    }
    return res.status(statusCode).json(body);
  }
});

// GET /groups/:groupId/messages/by-client-id/:clientMsgId -> 200 { msgId, sentAt } / 404
messagesRouter.get('/:groupId/messages/by-client-id/:clientMsgId', (req: Request, res: Response) => {
  const { groupId, clientMsgId } = req.params;

  const mockStatus = req.headers['x-mock-status'];
  if (mockStatus === '503') {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Gateway temporarily unavailable' } });
  }

  const message = gatewayStore.getMessageByClientId(groupId, clientMsgId);
  if (!message) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found by clientMsgId' } });
  }

  return res.status(200).json(message);
});

// GET /media/:id -> Return placeholder media file
messagesRouter.get('/media/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (id === 'expired') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Media expired or not found' } });
  }

  res.setHeader('Content-Type', 'text/plain');
  return res.send(`MOCK_MEDIA_CONTENT_FOR_${id}`);
});
