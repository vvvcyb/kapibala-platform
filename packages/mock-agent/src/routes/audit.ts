import { Router, Request, Response } from 'express';
import { AuditRequest, AuditResponse } from '../types.js';

export const auditRouter = Router();

// POST /agent/audit { text, groupId }
auditRouter.post('/', async (req: Request, res: Response) => {
  const { text, groupId: _groupId } = req.body as AuditRequest;

  // Simulation header override: delay
  const mockDelay = Number(req.headers['x-mock-audit-delay'] || 0);
  if (mockDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockDelay));
  }

  // Simulation header override: error
  const mockStatus = req.headers['x-mock-audit-status'];
  if (mockStatus) {
    return res.status(Number(mockStatus)).json({
      error: { code: 'MOCK_AUDIT_ERROR', message: `Simulated audit error ${mockStatus}` },
    });
  }

  // Simulation header override: bad json (SPEC 2.2: body is not valid json or missing verdict)
  if (req.headers['x-mock-audit-bad-json']) {
    res.setHeader('Content-Type', 'text/plain');
    return res.send('NOT_JSON_BODY');
  }

  if (typeof text !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'text field is required' },
    });
  }

  // Check violation rule per SPEC:
  // If text contains 'reject' or '违规', return fail
  const hasViolation = /reject|违规/i.test(text);

  const response: AuditResponse = hasViolation
    ? {
        verdict: 'fail',
        reason: 'audit policy violation: text contains prohibited keyword',
      }
    : {
        verdict: 'pass',
        reason: 'content safe',
      };

  return res.status(200).json(response);
});
