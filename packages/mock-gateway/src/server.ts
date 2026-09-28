import express from 'express';
import cors from 'cors';
import { accountsRouter } from './routes/accounts.js';
import { groupsRouter } from './routes/groups.js';
import { messagesRouter } from './routes/messages.js';
import { eventsRouter } from './routes/events.js';
import { mockControlRouter } from './routes/mock.js';

export function createGatewayApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'mock-gateway' });
  });

  // Mount API endpoints
  app.use('/accounts', accountsRouter);
  app.use('/groups', messagesRouter);
  app.use('/groups', groupsRouter);
  app.use('/events', eventsRouter);
  app.use('/mock', mockControlRouter);

  // Global 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  return app;
}
