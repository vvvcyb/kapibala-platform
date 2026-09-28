export interface AuthUser {
  userId: string;
  username: string;
  role: 'admin' | 'viewer';
}

export type AccountStatus =
  | 'idle'
  | 'online'
  | 'rate_limited'
  | 'disconnected'
  | 'suspended'
  | 'session_expired';

export interface Account {
  id: string;
  status: AccountStatus;
  platformUserId: string | null;
  rateLimitedUntil: string | null;
}

export interface GroupMember {
  accountId: string;
  platformUserId: string;
  role: 'creator' | 'admin' | 'member';
}

export interface Group {
  id: string;
  gatewayGroupId: string | null;
  status: 'active' | 'unreachable' | 'left';
  creatorAccountId: string;
  agentEnabled: boolean;
  autoKickEnabled: boolean;
  members: GroupMember[];
  activeSequenceRunId: string | null;
  activeAgentRunId: string | null;
}

export interface MessageItem {
  id: string;
  msgId: string | null;
  clientMsgId: string | null;
  senderPlatformUserId: string;
  isOwn: boolean;
  text: string;
  sentAt: string;
  deliveryStatus: 'queued' | 'accepted' | 'sent' | 'failed' | 'unknown' | 'cancelled' | null;
  failCode?: string | null;
}

export interface JobResult {
  status: 'running' | 'finished' | 'failed';
  progress?: number;
  step?: string | null;
  errors: Array<{ step: string; code: string }>;
  result?: { groupId: string; gatewayGroupId: string };
}

export interface AgentRunStep {
  index: number;
  kind: 'tool_use' | 'final' | 'protocol_error';
  toolUseId?: string | null;
  name?: string | null;
  input?: Record<string, unknown> | null;
  resultSummary?: string | null;
  isError?: boolean;
  errorCode?: string | null;
  auditVerdict?: string | null;
  rawResponse?: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  groupId: string;
  status: 'running' | 'finished' | 'failed' | 'blocked' | 'cancelled';
  endReason: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  steps?: AgentRunStep[];
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const GATEWAY_BASE = 'http://localhost:4001';

export function getToken(): string | null {
  return localStorage.getItem('kapibala_token');
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem('kapibala_token', token);
  } else {
    localStorage.removeItem('kapibala_token');
  }
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1]));
    return {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  login: async (username: string, password: string): Promise<{ accessToken: string }> => {
    return apiFetch<{ accessToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  getAccounts: async (): Promise<Account[]> => {
    return apiFetch<Account[]>('/api/accounts');
  },

  connectAccount: async (id: string): Promise<{ status: AccountStatus; platformUserId: string }> => {
    return apiFetch<{ status: AccountStatus; platformUserId: string }>(`/api/accounts/${id}/connect`, {
      method: 'POST',
    });
  },

  transitionAccount: async (id: string, expectedFrom: AccountStatus, to: AccountStatus): Promise<{ status: AccountStatus }> => {
    return apiFetch<{ status: AccountStatus }>(`/api/accounts/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ expectedFrom, to }),
    });
  },

  getGroups: async (): Promise<Group[]> => {
    return apiFetch<Group[]>('/api/groups');
  },

  getGroup: async (id: string): Promise<Group> => {
    return apiFetch<Group>(`/api/groups/${id}`);
  },

  createGroup: async (creatorAccountId: string, memberAccountIds: string[]): Promise<{ jobId: string }> => {
    return apiFetch<{ jobId: string }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ creatorAccountId, memberAccountIds }),
    });
  },

  getJob: async (jobId: string): Promise<JobResult> => {
    return apiFetch<JobResult>(`/api/jobs/${jobId}`);
  },

  updateGroupSettings: async (groupId: string, settings: { agentEnabled?: boolean; autoKickEnabled?: boolean }): Promise<{ success: boolean; group: Group }> => {
    return apiFetch<{ success: boolean; group: Group }>(`/api/groups/${groupId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  },

  sendMessage: async (groupId: string, accountId: string, text: string): Promise<{ clientMsgId: string }> => {
    return apiFetch<{ clientMsgId: string }>(`/api/groups/${groupId}/send`, {
      method: 'POST',
      body: JSON.stringify({ accountId, text }),
    });
  },

  getMessages: async (groupId: string, cursor?: string, limit = 20): Promise<{ items: MessageItem[]; nextCursor: string | null }> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(limit));
    return apiFetch<{ items: MessageItem[]; nextCursor: string | null }>(`/api/groups/${groupId}/messages?${params.toString()}`);
  },

  getGroupAgentRuns: async (groupId: string): Promise<AgentRun[]> => {
    return apiFetch<AgentRun[]>(`/api/groups/${groupId}/agent-runs`);
  },

  getAgentRun: async (runId: string): Promise<AgentRun> => {
    return apiFetch<AgentRun>(`/api/agent-runs/${runId}`);
  },

  // Gateway Simulation Helpers for Quick Test Bar
  simulateInboundMessage: async (gatewayGroupId: string, senderPlatformUserId: string, text: string) => {
    return fetch(`${GATEWAY_BASE}/mock/groups/${gatewayGroupId}/inbound-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderPlatformUserId, text }),
    }).then((r) => r.json());
  },

  simulateAddMember: async (gatewayGroupId: string, platformUserId: string) => {
    return fetch(`${GATEWAY_BASE}/mock/groups/${gatewayGroupId}/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformUserId }),
    }).then((r) => r.json());
  },
};
