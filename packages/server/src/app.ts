import express from 'express';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { accountsRouter } from './routes/accounts.js';
import { groupsRouter } from './routes/groups.js';
import { jobsRouter } from './routes/jobs.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(requestIdMiddleware);

  // Mount API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/jobs', jobsRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
