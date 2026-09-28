import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AuthUser } from '../types.js';

interface ClientContext {
  ws: WebSocket;
  user: AuthUser;
  seq: number;
  isAlive: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientContext>();
  private pingInterval: NodeJS.Timeout | null = null;

  public init(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const reqUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      const pathname = reqUrl.pathname;

      if (pathname === '/ws') {
        const token = reqUrl.searchParams.get('token');

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const user = jwt.verify(token, config.jwtSecret) as AuthUser;
          this.wss?.handleUpgrade(request, socket, head, (ws) => {
            this.handleConnection(ws, user);
          });
        } catch (err) {
          console.warn('[WebSocket] Token verification failed:', err);
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
      }
    });

    // 30s ping/pong heartbeat
    this.pingInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30000);
  }

  private handleConnection(ws: WebSocket, user: AuthUser): void {
    const client: ClientContext = {
      ws,
      user,
      seq: 1,
      isAlive: true,
    };

    this.clients.add(client);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('close', () => {
      this.clients.delete(client);
    });

    ws.on('error', (err) => {
      console.warn('[WebSocket] Client error:', err);
      this.clients.delete(client);
    });

    // Send welcome / connected frame
    this.sendToClient(client, 'connected', { userId: user.userId, role: user.role });
  }

  private sendToClient(client: ClientContext, type: string, data: unknown): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      const payload = {
        seq: client.seq++,
        type,
        data,
        timestamp: new Date().toISOString(),
      };
      client.ws.send(JSON.stringify(payload));
    }
  }

  public broadcast(type: string, data: unknown): void {
    for (const client of this.clients) {
      this.sendToClient(client, type, data);
    }
  }

  public notifyMessageNew(message: unknown): void {
    this.broadcast('message_new', message);
  }

  public notifyMessageUpdated(message: unknown): void {
    this.broadcast('message_updated', message);
  }

  public notifyAccountUpdated(account: unknown): void {
    this.broadcast('account_updated', account);
  }

  public notifyAgentRunStarted(run: unknown): void {
    this.broadcast('agent_run_started', run);
  }

  public notifyAgentRunStep(runId: string, step: unknown): void {
    this.broadcast('agent_run_step', { runId, step });
  }

  public notifyAgentRunFinished(run: unknown): void {
    this.broadcast('agent_run_finished', run);
  }

  public notifyGroupUpdated(group: unknown): void {
    this.broadcast('group_updated', group);
  }

  public close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const client of this.clients) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
  }
}

export const websocketService = new WebSocketService();
