import express from 'express';
import cors from 'cors';
import { turnRouter } from './routes/turn.js';
import { auditRouter } from './routes/audit.js';

export function createAgentApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'mock-agent' });
  });

  // SPEC 2.2 Endpoints:
  // POST /agent/turn
  // POST /agent/audit
  app.use('/agent/turn', turnRouter);
  app.use('/agent/audit', auditRouter);

  // Global 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  return app;
}
