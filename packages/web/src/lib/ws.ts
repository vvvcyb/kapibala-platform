import { getToken } from './api';

type EventCallback = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public connect(): void {
    const token = getToken();
    if (!token) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = (import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws') + `?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to realtime event bus');
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { type, data } = payload;
          if (type) {
            this.emit(type, data);
            // Also emit '*' for global event listeners
            this.emit('*', payload);
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (err) {
      console.error('[WebSocket] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  public subscribe(eventType: string, callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);

    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  private emit(eventType: string, data: any): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[WebSocket] Listener error on ${eventType}:`, err);
        }
      }
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const wsClient = new WebSocketClient();
