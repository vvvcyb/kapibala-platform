import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { gatewayClient } from './gateway-client.js';
import { accountService } from './account.service.js';
import { websocketService } from './websocket.service.js';
import { AppError } from '../types.js';

export class MessageService {
  public async sendGroupMessage(
    groupId: string,
    accountId: string,
    text: string
  ): Promise<{ clientMsgId: string }> {
    // 1. Check Group exists
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', `Group ${groupId} not found`);
    }

    // 2. Check Sender Account exists & check status
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`);
    }

    // SPEC A2: 账号为 idle / disconnected / 终态时 409 ACCOUNT_UNAVAILABLE
    if (
      account.status === 'idle' ||
      account.status === 'disconnected' ||
      account.status === 'suspended' ||
      account.status === 'session_expired'
    ) {
      throw new AppError(409, 'ACCOUNT_UNAVAILABLE', `Account ${accountId} is currently unavailable (${account.status})`);
    }

    // Check sender is in group
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_accountId: { groupId, accountId } },
    });
    if (!membership) {
      throw new AppError(409, 'ACCOUNT_NOT_IN_GROUP', `Account ${accountId} is not a member of group ${groupId}`);
    }

    // 3. Generate clientMsgId and record message as 'queued'
    const clientMsgId = `c_${crypto.randomUUID()}`;
    const senderPlatformUserId = account.platformUserId || `u_${accountId}`;

    const message = await prisma.message.create({
      data: {
        groupId,
        clientMsgId,
        senderPlatformUserId,
        isOwn: true,
        text,
        sentAt: new Date(), // SPEC: 受理时刻
        deliveryStatus: 'queued',
      },
    });

    websocketService.notifyMessageNew({
      id: message.id,
      groupId: message.groupId,
      clientMsgId: message.clientMsgId,
      senderPlatformUserId: message.senderPlatformUserId,
      isOwn: message.isOwn,
      text: message.text,
      sentAt: message.sentAt.toISOString(),
      deliveryStatus: message.deliveryStatus,
    });

    // 4. Dispatch handling:
    // If rate_limited: stays queued, will be sent after rate limit expires
    if (account.status === 'online' && group.gatewayGroupId) {
      this.dispatchOutboundMessage(message.id, group.gatewayGroupId, accountId, clientMsgId, text).catch(
        (err) => console.error(`[MessageService] Dispatch error for message ${message.id}:`, err)
      );
    }

    return { clientMsgId };
  }

  public async dispatchOutboundMessage(
    messageId: string,
    gatewayGroupId: string,
    accountId: string,
    clientMsgId: string,
    text: string,
    isRetry = false
  ): Promise<void> {
    try {
      const res = await gatewayClient.sendMessage(gatewayGroupId, accountId, clientMsgId, text);
      if (res.accepted) {
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'accepted' },
        });
        websocketService.notifyMessageUpdated(updated);
      }
    } catch (err: unknown) {
      const errorObj = err as {
        statusCode?: number;
        code?: string;
        details?: { retryAfterSeconds?: number };
      };

      const code = errorObj.code;

      if (code === 'RATE_LIMITED') {
        const retryAfter = errorObj.details?.retryAfterSeconds || 5;
        await accountService.handleRateLimited(accountId, retryAfter);
        // Message remains queued
        return;
      }

      if (code === 'NETWORK_TIMEOUT' || errorObj.statusCode === 504) {
        // Mark unknown
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'unknown' },
        });
        websocketService.notifyMessageUpdated(updated);

        // Launch probe task to check by-client-id within 5s
        this.probeTimeoutMessage(messageId, gatewayGroupId, accountId, clientMsgId, text, isRetry);
        return;
      }

      if (code === 'GROUP_WRITE_FORBIDDEN') {
        await prisma.group.updateMany({
          where: { gatewayGroupId },
          data: { status: 'unreachable' },
        });
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'failed', failCode: 'GROUP_WRITE_FORBIDDEN' },
        });
        websocketService.notifyMessageUpdated(updated);
        return;
      }

      if (code === 'ACCOUNT_SUSPENDED') {
        await accountService.handleTerminalState(accountId, 'suspended');
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'cancelled', failCode: 'ACCOUNT_TERMINAL' },
        });
        websocketService.notifyMessageUpdated(updated);
        return;
      }

      if (code === 'SESSION_EXPIRED') {
        await accountService.handleTerminalState(accountId, 'session_expired');
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'cancelled', failCode: 'ACCOUNT_TERMINAL' },
        });
        websocketService.notifyMessageUpdated(updated);
        return;
      }

      // SENDER_NOT_IN_GROUP, ACCOUNT_OFFLINE, or other failures
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { deliveryStatus: 'failed', failCode: code || 'GATEWAY_ERROR' },
      });
      websocketService.notifyMessageUpdated(updated);
    }
  }

  private async probeTimeoutMessage(
    messageId: string,
    gatewayGroupId: string,
    accountId: string,
    clientMsgId: string,
    text: string,
    hasRetried: boolean
  ): Promise<void> {
    // Wait 2 seconds for potential landing
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const landed = await gatewayClient.getMessageByClientId(gatewayGroupId, clientMsgId);
      if (landed) {
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: {
            msgId: landed.msgId,
            sentAt: new Date(landed.sentAt),
            deliveryStatus: 'sent',
          },
        });
        websocketService.notifyMessageUpdated(updated);
        return;
      }

      // Not landed. SPEC A2: "确认没有发出时，可以用同一个 clientMsgId 重发一次，总共只允许重发一次；重发后仍未发出 → failed（failCode = NETWORK_TIMEOUT）"
      if (!hasRetried) {
        await this.dispatchOutboundMessage(messageId, gatewayGroupId, accountId, clientMsgId, text, true);
      } else {
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { deliveryStatus: 'failed', failCode: 'NETWORK_TIMEOUT' },
        });
        websocketService.notifyMessageUpdated(updated);
      }
    } catch (err) {
      console.warn(`[MessageService] Probe failed for ${clientMsgId}:`, err);
    }
  }

  public async processQueuedMessagesForAccount(accountId: string): Promise<void> {
    const senderPlatformUserId = `u_${accountId}`;
    const queuedMessages = await prisma.message.findMany({
      where: {
        senderPlatformUserId,
        deliveryStatus: 'queued',
      },
      include: {
        group: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const msg of queuedMessages) {
      if (msg.group.gatewayGroupId && msg.clientMsgId) {
        await this.dispatchOutboundMessage(
          msg.id,
          msg.group.gatewayGroupId,
          accountId,
          msg.clientMsgId,
          msg.text
        );
      }
    }
  }

  /**
   * Cursor-based stable descending pagination
   * Ensures that even if new messages arrive during reading older history,
   * no duplicates or missed items can occur.
   */
  public async getMessages(groupId: string, cursorOrBefore?: string, limit = 50) {
    const take = Math.min(Math.max(1, limit), 100);

    const where: Record<string, unknown> = { groupId };

    if (cursorOrBefore) {
      // Look up cursor item by id or msgId or clientMsgId
      const cursorItem = await prisma.message.findFirst({
        where: {
          groupId,
          OR: [
            { id: cursorOrBefore },
            { msgId: cursorOrBefore },
            { clientMsgId: cursorOrBefore },
          ],
        },
      });

      if (cursorItem) {
        where.OR = [
          { sentAt: { lt: cursorItem.sentAt } },
          { sentAt: cursorItem.sentAt, id: { lt: cursorItem.id } },
        ];
      } else {
        // Fallback if cursorOrBefore is an ISO Date string
        const parsedDate = new Date(cursorOrBefore);
        if (!isNaN(parsedDate.getTime())) {
          where.sentAt = { lt: parsedDate };
        }
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    let nextCursor: string | null = null;
    if (messages.length > take) {
      const lastItem = messages[take - 1];
      nextCursor = lastItem.msgId || lastItem.id;
      messages.pop();
    }

    const items = messages.map((m) => ({
      id: m.id,
      msgId: m.msgId,
      clientMsgId: m.clientMsgId,
      senderPlatformUserId: m.senderPlatformUserId,
      isOwn: m.isOwn,
      text: m.text,
      sentAt: m.sentAt.toISOString(),
      deliveryStatus: m.deliveryStatus,
      failCode: m.failCode,
    }));

    return { items, nextCursor };
  }
}

export const messageService = new MessageService();
