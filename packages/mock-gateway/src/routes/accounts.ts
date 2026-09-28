import { Router, Request, Response } from 'express';
import { gatewayStore } from '../store.js';

export const accountsRouter = Router();

// GET /accounts - List all accounts (helper for debugging)
accountsRouter.get('/', (_req: Request, res: Response) => {
  res.json(gatewayStore.getAllAccounts());
});

// POST /accounts/:accountId/connect -> { platformUserId }
accountsRouter.post('/:accountId/connect', (req: Request, res: Response) => {
  const { accountId } = req.params;

  // Simulation header override
  const mockStatus = req.headers['x-mock-status'];
  if (mockStatus === '403' || mockStatus === 'ACCOUNT_SUSPENDED') {
    return res.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' } });
  }
  if (mockStatus === '401' || mockStatus === 'SESSION_EXPIRED') {
    return res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
  }

  try {
    const result = gatewayStore.connectAccount(accountId);
    return res.status(200).json(result);
  } catch (err: unknown) {
    const errorObj = err as { code?: string; status?: number; message?: string };
    if (errorObj.code === 'ACCOUNT_SUSPENDED') {
      return res.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' } });
    }
    if (errorObj.code === 'SESSION_EXPIRED') {
      return res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: errorObj.message || 'Internal error' } });
  }
});

// POST /accounts/:accountId/disconnect -> 200
accountsRouter.post('/:accountId/disconnect', (req: Request, res: Response) => {
  const { accountId } = req.params;
  gatewayStore.disconnectAccount(accountId);
  return res.status(200).json({ success: true });
});
