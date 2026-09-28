import { createApp } from './app.js';
import { config } from './config.js';
import { gatewaySSEService } from './services/gateway-sse.js';

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(config.port, () => {
    console.log(`[server] Core backend running on http://localhost:${config.port}`);
    // Start SSE listener to message gateway
    gatewaySSEService.start();
  });

  const shutdown = () => {
    console.log('[server] Shutting down gracefully...');
    gatewaySSEService.stop();
    server.close(() => {
      console.log('[server] Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
