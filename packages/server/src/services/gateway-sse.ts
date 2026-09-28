import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { groupService } from './group.service.js';
import { accountService } from './account.service.js';
import { agentRunner } from './agent-runner.js';
import { websocketService } from './websocket.service.js';

interface SSEFrame {
  id?: number;
  event?: string;
  data?: Record<string, unknown>;
}

export class GatewaySSEService {
  private lastEventId = 0;
  private isRunning = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private async connect(): Promise<void> {
    if (!this.isRunning) return;

    const url = `${config.gatewayUrl.replace(/\/+$/, '')}/events?since=${this.lastEventId}`;
    console.log(`[GatewaySSE] Connecting to SSE stream at ${url}...`);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect to SSE stream: status ${response.status}`);
      }

      console.log('[GatewaySSE] SSE Stream connected.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isRunning) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentFrame: SSEFrame = {};

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            // Empty line means dispatch frame
            if (currentFrame.event && currentFrame.data) {
              await this.handleEvent(currentFrame);
            }
            currentFrame = {};
            continue;
          }

          if (trimmed.startsWith(':')) {
            // Comment or heartbeat ping, ignore
            continue;
          }

          const colonIdx = trimmed.indexOf(':');
          if (colonIdx === -1) continue;

          const field = trimmed.slice(0, colonIdx).trim();
          const val = trimmed.slice(colonIdx + 1).trim();

          if (field === 'id') {
            currentFrame.id = parseInt(val, 10);
            if (!isNaN(currentFrame.id)) {
              this.lastEventId = currentFrame.id;
            }
          } else if (field === 'event') {
            currentFrame.event = val;
          } else if (field === 'data') {
            try {
              currentFrame.data = JSON.parse(val);
            } catch {
              currentFrame.data = { raw: val };
            }
          }
        }
      }
    } catch (err) {
      console.warn('[GatewaySSE] SSE connection interrupted:', (err as Error).message);
    }

    if (this.isRunning) {
      console.log('[GatewaySSE] Reconnecting in 2 seconds...');
      this.reconnectTimeout = setTimeout(() => this.connect(), 2000);
    }
  }

  private async handleEvent(frame: SSEFrame): Promise<void> {
    const { event, data } = frame;
    if (!event || !data) return;

    try {
      switch (event) {
        case 'member_joined': {
          const { groupId, platformUserId } = data as { groupId: string; platformUserId: string };
          if (groupId && platformUserId) {
            groupService.onMemberJoinedEvent(groupId, platformUserId);
            const group = await prisma.group.findUnique({ where: { gatewayGroupId: groupId } });
            if (group) {
              websocketService.notifyGroupUpdated({
                groupId: group.id,
                action: 'member_joined',
                platformUserId,
              });
            }
          }
          break;
        }

        case 'member_left': {
          const { groupId, platformUserId } = data as { groupId: string; platformUserId: string };
          if (groupId && platformUserId) {
            const group = await prisma.group.findUnique({ where: { gatewayGroupId: groupId } });
            if (group) {
              await prisma.groupMember.deleteMany({
                where: { groupId: group.id, platformUserId },
              });
              websocketService.notifyGroupUpdated({ groupId: group.id, action: 'member_left', platformUserId });
            }
          }
          break;
        }

        case 'account_status': {
          const { accountId, status } = data as { accountId: string; status: 'suspended' | 'session_expired' };
          if (accountId && status) {
            await accountService.handleTerminalState(accountId, status);
            websocketService.notifyAccountUpdated({ accountId, status });
          }
          break;
        }

        case 'message_sent': {
          const { clientMsgId, msgId, sentAt } = data as { clientMsgId: string; msgId: string; sentAt: string };
          if (clientMsgId) {
            await prisma.message.updateMany({
              where: { clientMsgId },
              data: {
                msgId,
                sentAt: new Date(sentAt),
                deliveryStatus: 'sent',
              },
            });
            const updated = await prisma.message.findFirst({ where: { clientMsgId } });
            if (updated) {
              websocketService.notifyMessageUpdated(updated);
            }
          }
          break;
        }

        case 'message': {
          const { groupId: gatewayGroupId, msgId, senderPlatformUserId, text, sentAt } = data as {
            groupId: string;
            msgId: string;
            senderPlatformUserId: string;
            text: string;
            sentAt: string;
          };

          const group = await prisma.group.findUnique({ where: { gatewayGroupId } });
          if (!group) return;

          // Check if sender is one of our own accounts
          const ownAccount = await prisma.account.findFirst({
            where: { platformUserId: senderPlatformUserId },
          });
          const isOwn = Boolean(ownAccount);

          // Deduplicate by (groupId, msgId)
          const existing = await prisma.message.findFirst({
            where: { groupId: group.id, msgId },
          });

          if (!existing) {
            const savedMsg = await prisma.message.create({
              data: {
                groupId: group.id,
                msgId,
                senderPlatformUserId,
                isOwn,
                text,
                sentAt: new Date(sentAt),
                deliveryStatus: isOwn ? 'sent' : null,
              },
            });

            websocketService.notifyMessageNew(savedMsg);

            // Trigger Agent Runner
            agentRunner.onInboundMessage(savedMsg).catch((err) => {
              console.error('[GatewaySSE] Error triggering agentRunner:', err);
            });
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      // SPEC A2: 处理网关事件时如果自己的数据库写入失败，不能让事件处理中断，也不能让这个事件的内容丢失；同时推 inconsistency 事件
      console.error(`[GatewaySSE] Error handling event ${event}:`, err);
      websocketService.broadcast('inconsistency', {
        event,
        error: (err as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const gatewaySSEService = new GatewaySSEService();
