import {
  Account,
  AccountStatus,
  GatewayEvent,
  GatewayEventType,
  GatewayMessage,
  Group,
  GroupMember,
  InviteLinkInfo,
  SimulationConfig,
} from './types.js';

export class GatewayStore {
  public accounts = new Map<string, Account>();
  public groups = new Map<string, Group>();
  private eventsBuffer: GatewayEvent[] = [];
  private eventListeners = new Set<(event: GatewayEvent) => void>();
  private nextEventId = 1;
  private groupCounter = 1;
  private messageCounter = 1;

  public simulation: SimulationConfig = {
    duplicateEvents: false,
    defaultSendDelayMs: 200,
    defaultJoinDelayMs: 300,
    failNextSendCode: null,
    timeoutNextSend: false,
  };

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.accounts.clear();
    this.groups.clear();
    this.eventsBuffer = [];
    this.nextEventId = 1;
    this.groupCounter = 1;
    this.messageCounter = 1;

    // Preset test accounts: account_1, account_2, account_3, account_4 with status = idle
    for (let i = 1; i <= 4; i++) {
      const accountId = `account_${i}`;
      this.accounts.set(accountId, {
        accountId,
        status: 'idle',
        platformUserId: null,
        rateLimitedUntil: null,
      });
    }

    this.simulation = {
      duplicateEvents: false,
      defaultSendDelayMs: 200,
      defaultJoinDelayMs: 300,
      failNextSendCode: null,
      timeoutNextSend: false,
    };
  }

  // ==================== SSE Events ====================

  public subscribeEvents(listener: (event: GatewayEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public emitEvent(type: GatewayEventType, data: Record<string, unknown>): GatewayEvent {
    const event: GatewayEvent = {
      eventId: this.nextEventId++,
      type,
      ...data,
    };

    this.eventsBuffer.push(event);

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error dispatching event to listener:', err);
      }
    }

    // Support S2 duplicate events simulation if enabled
    if (this.simulation.duplicateEvents) {
      setTimeout(() => {
        for (const listener of this.eventListeners) {
          try {
            listener(event);
          } catch (err) {
            console.error('Error dispatching duplicated event to listener:', err);
          }
        }
      }, 50);
    }

    return event;
  }

  public getEventsSince(since?: number): GatewayEvent[] {
    if (since === undefined || isNaN(since)) {
      return [];
    }
    return this.eventsBuffer.filter((e) => e.eventId > since);
  }

  // ==================== Accounts ====================

  public getAccount(accountId: string): Account | undefined {
    return this.accounts.get(accountId);
  }

  public getAllAccounts(): Account[] {
    return Array.from(this.accounts.values());
  }

  public connectAccount(accountId: string): { status: AccountStatus; platformUserId: string } {
    let account = this.accounts.get(accountId);
    if (!account) {
      account = {
        accountId,
        status: 'idle',
        platformUserId: null,
        rateLimitedUntil: null,
      };
      this.accounts.set(accountId, account);
    }

    if (account.status === 'suspended') {
      const err = new Error('ACCOUNT_SUSPENDED');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_SUSPENDED';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    if (account.status === 'session_expired') {
      const err = new Error('SESSION_EXPIRED');
      (err as unknown as { code: string; status: number }).code = 'SESSION_EXPIRED';
      (err as unknown as { code: string; status: number }).status = 401;
      throw err;
    }

    const platformUserId = `u_${accountId}`;
    account.status = 'online';
    account.platformUserId = platformUserId;

    return {
      status: account.status,
      platformUserId,
    };
  }

  public disconnectAccount(accountId: string): void {
    const account = this.accounts.get(accountId);
    if (account) {
      account.status = 'disconnected';
    }
  }

  public setAccountStatus(accountId: string, status: 'suspended' | 'session_expired'): void {
    const account = this.accounts.get(accountId);
    if (!account) return;

    account.status = status;

    // SPEC 2.1: "网关会主动推 account_status 事件：{ accountId, status: 'suspended' | 'session_expired' }。
    // 账号进入这两种状态后，网关会自动把它移出所有群并推 member_left。"
    this.emitEvent('account_status', {
      accountId,
      status,
    });

    const platformUserId = account.platformUserId || `u_${accountId}`;

    // Remove from all groups
    for (const group of this.groups.values()) {
      if (group.members.has(platformUserId)) {
        group.members.delete(platformUserId);
        this.emitEvent('member_left', {
          groupId: group.groupId,
          platformUserId,
        });
      }
    }
  }

  public setAccountRateLimit(accountId: string, retryAfterSeconds: number): void {
    const account = this.accounts.get(accountId);
    if (account) {
      account.rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
    }
  }

  // ==================== Groups ====================

  public getGroup(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  public ensureGroupWithDefaultMembers(groupId: string): Group {
    let group = this.groups.get(groupId);
    if (!group) {
      const defaultAccounts: Array<{ id: string; role: 'creator' | 'admin' | 'member' }> = [
        { id: 'account_1', role: 'creator' },
        { id: 'account_2', role: 'admin' },
        { id: 'account_3', role: 'member' },
      ];

      for (const item of defaultAccounts) {
        const acc = this.accounts.get(item.id);
        if (!acc || acc.status === 'idle' || acc.status === 'disconnected') {
          try {
            this.connectAccount(item.id);
          } catch {}
        }
      }

      const members = new Map<string, GroupMember>();
      for (const item of defaultAccounts) {
        const acc = this.accounts.get(item.id);
        const platformUserId = acc?.platformUserId || `u_${item.id}`;
        members.set(platformUserId, {
          platformUserId,
          accountId: item.id,
          role: item.role,
          joinedAt: new Date().toISOString(),
        });
      }

      group = {
        groupId,
        creatorAccountId: 'account_1',
        members,
        inviteLinks: new Map(),
        messages: [],
        writeForbidden: false,
        ownerLeft: false,
      };

      this.groups.set(groupId, group);
    }
    return group;
  }

  public createGroup(creatorAccountId: string): { groupId: string } {
    const account = this.accounts.get(creatorAccountId);
    if (!account || account.status === 'idle' || account.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }
    if (account.status === 'suspended') {
      const err = new Error('ACCOUNT_SUSPENDED');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_SUSPENDED';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }
    if (account.status === 'session_expired') {
      const err = new Error('SESSION_EXPIRED');
      (err as unknown as { code: string; status: number }).code = 'SESSION_EXPIRED';
      (err as unknown as { code: string; status: number }).status = 401;
      throw err;
    }

    const groupId = `g_${this.groupCounter++}`;
    const creatorPlatformUserId = account.platformUserId || `u_${creatorAccountId}`;

    const members = new Map<string, GroupMember>();
    // Creator is immediately a member with role = creator
    members.set(creatorPlatformUserId, {
      platformUserId: creatorPlatformUserId,
      accountId: creatorAccountId,
      role: 'creator',
      joinedAt: new Date().toISOString(),
    });

    const group: Group = {
      groupId,
      creatorAccountId,
      members,
      inviteLinks: new Map<string, InviteLinkInfo>(),
      messages: [],
      writeForbidden: false,
      ownerLeft: false,
    };

    this.groups.set(groupId, group);

    // SPEC: "创建者账号成为群主，在响应返回时即为成员，网关不会为它推 member_joined。"
    return { groupId };
  }

  public createInvite(groupId: string, readyAfterMs = 0): { inviteLink: string; readyAfterMs: number } {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    const inviteLink = `inv_${groupId}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    group.inviteLinks.set(inviteLink, {
      inviteLink,
      createdAt: now,
      readyAfterMs,
      expiresAt: now + 3600000, // 1 hour
      expired: false,
    });

    return { inviteLink, readyAfterMs };
  }

  public joinGroup(groupId: string, accountId: string, inviteLink: string): { accepted: true } {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    const account = this.accounts.get(accountId);
    if (!account || account.status === 'idle' || account.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const linkInfo = group.inviteLinks.get(inviteLink);
    if (!linkInfo || linkInfo.expired || Date.now() > linkInfo.expiresAt) {
      const err = new Error('INVITE_EXPIRED');
      (err as unknown as { code: string; status: number }).code = 'INVITE_EXPIRED';
      (err as unknown as { code: string; status: number }).status = 410;
      throw err;
    }

    if (Date.now() < linkInfo.createdAt + linkInfo.readyAfterMs) {
      const err = new Error('INVITE_NOT_READY');
      (err as unknown as { code: string; status: number }).code = 'INVITE_NOT_READY';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const platformUserId = account.platformUserId || `u_${accountId}`;
    if (group.members.has(platformUserId)) {
      const err = new Error('ALREADY_MEMBER');
      (err as unknown as { code: string; status: number }).code = 'ALREADY_MEMBER';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    // Schedule delayed join (300ms)
    setTimeout(() => {
      // Re-verify group and account still exist
      if (this.groups.has(groupId)) {
        group.members.set(platformUserId, {
          platformUserId,
          accountId,
          role: 'member',
          joinedAt: new Date().toISOString(),
        });

        this.emitEvent('member_joined', {
          groupId,
          platformUserId,
        });
      }
    }, this.simulation.defaultJoinDelayMs);

    return { accepted: true };
  }

  public promoteMember(groupId: string, byAccountId: string, accountId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    const byAccount = this.accounts.get(byAccountId);
    if (!byAccount || byAccount.status === 'idle' || byAccount.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const byPlatformUserId = byAccount.platformUserId || `u_${byAccountId}`;
    const callerMember = group.members.get(byPlatformUserId);

    if (!callerMember || callerMember.role !== 'creator') {
      const err = new Error('NO_PERMISSION');
      (err as unknown as { code: string; status: number }).code = 'NO_PERMISSION';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    const targetPlatformUserId = `u_${accountId}`;
    const targetMember = group.members.get(targetPlatformUserId);

    if (!targetMember) {
      const err = new Error('NOT_MEMBER_YET');
      (err as unknown as { code: string; status: number }).code = 'NOT_MEMBER_YET';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    targetMember.role = 'admin';
    // SPEC: "promote 不推事件。"
  }

  public kickMember(groupId: string, byAccountId: string, targetPlatformUserId: string): { kicked: true } {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    if (group.ownerLeft) {
      const err = new Error('OWNER_LEFT');
      (err as unknown as { code: string; status: number }).code = 'OWNER_LEFT';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const byAccount = this.accounts.get(byAccountId);
    if (!byAccount || byAccount.status === 'idle' || byAccount.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const byPlatformUserId = byAccount.platformUserId || `u_${byAccountId}`;
    const callerMember = group.members.get(byPlatformUserId);

    if (!callerMember || (callerMember.role !== 'creator' && callerMember.role !== 'admin')) {
      const err = new Error('NO_PERMISSION');
      (err as unknown as { code: string; status: number }).code = 'NO_PERMISSION';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    // SPEC: "目标在 200 返回前已从成员列表移除，随后推 member_left。"
    group.members.delete(targetPlatformUserId);

    setTimeout(() => {
      this.emitEvent('member_left', {
        groupId,
        platformUserId: targetPlatformUserId,
      });
    }, 50);

    return { kicked: true };
  }

  public leaveGroup(groupId: string, accountId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    const account = this.accounts.get(accountId);
    if (!account || account.status === 'idle' || account.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    const platformUserId = account.platformUserId || `u_${accountId}`;
    const member = group.members.get(platformUserId);

    if (member && member.role === 'creator') {
      group.ownerLeft = true;
    }

    group.members.delete(platformUserId);

    setTimeout(() => {
      this.emitEvent('member_left', {
        groupId,
        platformUserId,
      });
    }, 50);
  }

  public getMembers(groupId: string): Array<{ platformUserId: string }> {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    return Array.from(group.members.values()).map((m) => ({
      platformUserId: m.platformUserId,
    }));
  }

  // ==================== Messages ====================

  public sendMessage(
    groupId: string,
    accountId: string,
    clientMsgId: string,
    text: string
  ): { accepted: true } {
    const group = this.groups.get(groupId);
    if (!group) {
      const err = new Error('GROUP_NOT_FOUND');
      (err as unknown as { code: string; status: number }).code = 'GROUP_NOT_FOUND';
      (err as unknown as { code: string; status: number }).status = 404;
      throw err;
    }

    if (group.writeForbidden) {
      const err = new Error('GROUP_WRITE_FORBIDDEN');
      (err as unknown as { code: string; status: number }).code = 'GROUP_WRITE_FORBIDDEN';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    const account = this.accounts.get(accountId);
    if (!account || account.status === 'idle' || account.status === 'disconnected') {
      const err = new Error('ACCOUNT_OFFLINE');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_OFFLINE';
      (err as unknown as { code: string; status: number }).status = 409;
      throw err;
    }

    if (account.status === 'suspended') {
      const err = new Error('ACCOUNT_SUSPENDED');
      (err as unknown as { code: string; status: number }).code = 'ACCOUNT_SUSPENDED';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    if (account.status === 'session_expired') {
      const err = new Error('SESSION_EXPIRED');
      (err as unknown as { code: string; status: number }).code = 'SESSION_EXPIRED';
      (err as unknown as { code: string; status: number }).status = 401;
      throw err;
    }

    if (account.rateLimitedUntil && Date.now() < account.rateLimitedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((account.rateLimitedUntil - Date.now()) / 1000));
      // Re-trigger / reset timer per SPEC: "等待期内该账号的任何 send 都会再次得到同样的错误，并且计时重置"
      account.rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
      const err = new Error('RATE_LIMITED');
      (err as unknown as { code: string; status: number; retryAfterSeconds: number }).code = 'RATE_LIMITED';
      (err as unknown as { code: string; status: number; retryAfterSeconds: number }).status = 429;
      (err as unknown as { code: string; status: number; retryAfterSeconds: number }).retryAfterSeconds = retryAfterSeconds;
      throw err;
    }

    const senderPlatformUserId = account.platformUserId || `u_${accountId}`;
    if (!group.members.has(senderPlatformUserId)) {
      const err = new Error('SENDER_NOT_IN_GROUP');
      (err as unknown as { code: string; status: number }).code = 'SENDER_NOT_IN_GROUP';
      (err as unknown as { code: string; status: number }).status = 403;
      throw err;
    }

    // Delay delivery (default 200ms)
    setTimeout(() => {
      const msgId = `m_${this.messageCounter++}`;
      const sentAt = new Date().toISOString();

      const message: GatewayMessage = {
        groupId,
        msgId,
        clientMsgId,
        senderPlatformUserId,
        text,
        sentAt,
      };

      group.messages.push(message);

      // SPEC: "消息真正发出以 message_sent { clientMsgId, msgId, sentAt } 事件为准"
      this.emitEvent('message_sent', {
        groupId,
        clientMsgId,
        msgId,
        sentAt,
      });

      // SPEC: "message 事件：{ groupId, msgId, senderPlatformUserId, text, sentAt, mediaUrl? }。
      // 包括服务账号自己发出的消息（其 msgId 与对应 message_sent 里的相同）"
      this.emitEvent('message', {
        groupId,
        msgId,
        senderPlatformUserId,
        text,
        sentAt,
      });
    }, this.simulation.defaultSendDelayMs);

    return { accepted: true };
  }

  public getMessageByClientId(groupId: string, clientMsgId: string): { msgId: string; sentAt: string } | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;

    const found = group.messages.find((m) => m.clientMsgId === clientMsgId);
    if (!found) return undefined;

    return {
      msgId: found.msgId,
      sentAt: found.sentAt,
    };
  }

  public setGroupWriteForbidden(groupId: string, forbidden: boolean): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.writeForbidden = forbidden;
    }
  }

  public expireInviteLink(groupId: string, inviteLink: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      const link = group.inviteLinks.get(inviteLink);
      if (link) {
        link.expired = true;
      }
    }
  }
}

export const gatewayStore = new GatewayStore();
