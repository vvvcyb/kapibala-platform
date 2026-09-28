export type AccountStatus =
  | 'idle'
  | 'online'
  | 'disconnected'
  | 'suspended'
  | 'session_expired';

export type GatewayEventType =
  | 'message'
  | 'message_sent'
  | 'message_failed'
  | 'member_joined'
  | 'member_left'
  | 'account_status';

export interface GatewayEvent {
  eventId: number;
  type: GatewayEventType;
  [key: string]: unknown;
}

export interface Account {
  accountId: string;
  status: AccountStatus;
  platformUserId: string | null;
  rateLimitedUntil: number | null;
}

export interface GroupMember {
  platformUserId: string;
  accountId?: string;
  role: 'creator' | 'admin' | 'member';
  joinedAt: string;
}

export interface InviteLinkInfo {
  inviteLink: string;
  createdAt: number;
  readyAfterMs: number;
  expiresAt: number;
  expired?: boolean;
}

export interface GatewayMessage {
  groupId: string;
  msgId: string;
  clientMsgId?: string;
  senderPlatformUserId: string;
  text: string;
  sentAt: string;
  mediaUrl?: string;
}

export interface Group {
  groupId: string;
  creatorAccountId: string;
  members: Map<string, GroupMember>;
  inviteLinks: Map<string, InviteLinkInfo>;
  messages: GatewayMessage[];
  writeForbidden: boolean;
  ownerLeft: boolean;
}

export interface SimulationConfig {
  duplicateEvents: boolean;
  defaultSendDelayMs: number;
  defaultJoinDelayMs: number;
  failNextSendCode: string | null;
  timeoutNextSend: boolean;
}
