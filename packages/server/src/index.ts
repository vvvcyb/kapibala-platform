import http from 'http';
import { createApp } from './app.js';
import { config } from './config.js';
import { gatewaySSEService } from './services/gateway-sse.js';
import { websocketService } from './services/websocket.service.js';

const app = createApp();
const server = http.createServer(app);

// Initialize WebSocket server on /ws
websocketService.init(server);

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, () => {
    console.log(`[server] Core backend running on http://localhost:${config.port}`);
    console.log(`[server] WebSocket server available on ws://localhost:${config.port}/ws`);
    // Start SSE listener to message gateway
    gatewaySSEService.start();
  });

  const shutdown = () => {
    console.log('[server] Shutting down gracefully...');
    gatewaySSEService.stop();
    websocketService.close();
    server.close(() => {
      console.log('[server] Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
