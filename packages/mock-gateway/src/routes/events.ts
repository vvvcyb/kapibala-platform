import { Router, Request, Response } from 'express';
import { gatewayStore } from '../store.js';
import { GatewayEvent } from '../types.js';

export const eventsRouter = Router();

// GET /events?since=<eventId> (Server-Sent Events)
eventsRouter.get('/', (req: Request, res: Response) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering
  });

  // Flush headers immediately
  res.flushHeaders?.();

  const sinceParam = req.query.since as string | undefined;
  const since = sinceParam !== undefined ? parseInt(sinceParam, 10) : undefined;

  // Send SSE frame helper
  const sendEvent = (event: GatewayEvent) => {
    res.write(`id: ${event.eventId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay history if since is provided
  if (since !== undefined && !isNaN(since)) {
    const historicalEvents = gatewayStore.getEventsSince(since);
    for (const evt of historicalEvents) {
      sendEvent(evt);
    }
  }

  // Subscribe to live events
  const unsubscribe = gatewayStore.subscribeEvents((event: GatewayEvent) => {
    sendEvent(event);
  });

  // Heartbeat ping every 15s to keep connection alive
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    unsubscribe();
  });
});
