import { config } from '../config.js';
import { AppError } from '../types.js';

export class GatewayClient {
  private baseUrl: string;

  constructor(baseUrl = config.gatewayUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    let response: globalThis.Response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (err) {
      throw new AppError(504, 'GATEWAY_UNAVAILABLE', `Failed to connect to message gateway at ${url}: ${(err as Error).message}`);
    }

    const data = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok) {
      const errorObj = (data?.error || data || {}) as { code?: string; message?: string; retryAfterSeconds?: number };
      const code = errorObj.code || `HTTP_${response.status}`;
      const message = errorObj.message || `Gateway returned status ${response.status}`;

      const details: Record<string, unknown> = {};
      if (errorObj.retryAfterSeconds !== undefined) {
        details.retryAfterSeconds = errorObj.retryAfterSeconds;
      }

      throw new AppError(response.status, code, message, details);
    }

    return data as T;
  }

  public async connectAccount(accountId: string): Promise<{ platformUserId: string }> {
    return this.request<{ platformUserId: string }>(`/accounts/${accountId}/connect`, {
      method: 'POST',
    });
  }

  public async disconnectAccount(accountId: string): Promise<void> {
    await this.request<{ success: boolean }>(`/accounts/${accountId}/disconnect`, {
      method: 'POST',
    });
  }

  public async createGroup(creatorAccountId: string): Promise<{ groupId: string }> {
    return this.request<{ groupId: string }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ creatorAccountId }),
    });
  }

  public async createInvite(gatewayGroupId: string, readyAfterMs = 0): Promise<{ inviteLink: string; readyAfterMs: number }> {
    return this.request<{ inviteLink: string; readyAfterMs: number }>(`/groups/${gatewayGroupId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ readyAfterMs }),
    });
  }

  public async joinGroup(gatewayGroupId: string, accountId: string, inviteLink: string): Promise<{ accepted: boolean }> {
    return this.request<{ accepted: boolean }>(`/groups/${gatewayGroupId}/join`, {
      method: 'POST',
      body: JSON.stringify({ accountId, inviteLink }),
    });
  }

  public async promoteMember(gatewayGroupId: string, byAccountId: string, accountId: string): Promise<void> {
    await this.request<void>(`/groups/${gatewayGroupId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ byAccountId, accountId }),
    });
  }

  public async kickMember(gatewayGroupId: string, byAccountId: string, targetPlatformUserId: string): Promise<{ kicked: boolean }> {
    return this.request<{ kicked: boolean }>(`/groups/${gatewayGroupId}/kick`, {
      method: 'POST',
      body: JSON.stringify({ byAccountId, targetPlatformUserId }),
    });
  }

  public async leaveGroup(gatewayGroupId: string, accountId: string): Promise<void> {
    await this.request<void>(`/groups/${gatewayGroupId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    });
  }

  public async getMembers(gatewayGroupId: string): Promise<Array<{ platformUserId: string }>> {
    return this.request<Array<{ platformUserId: string }>>(`/groups/${gatewayGroupId}/members`, {
      method: 'GET',
    });
  }

  public async sendMessage(
    gatewayGroupId: string,
    accountId: string,
    clientMsgId: string,
    text: string
  ): Promise<{ accepted: boolean }> {
    return this.request<{ accepted: boolean }>(`/groups/${gatewayGroupId}/send`, {
      method: 'POST',
      body: JSON.stringify({ accountId, clientMsgId, text }),
    });
  }

  public async getMessageByClientId(
    gatewayGroupId: string,
    clientMsgId: string
  ): Promise<{ msgId: string; sentAt: string } | null> {
    try {
      const res = await this.request<{ msgId: string; sentAt: string }>(
        `/groups/${gatewayGroupId}/messages/by-client-id/${clientMsgId}`,
        { method: 'GET' }
      );
      return res;
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }
}

export const gatewayClient = new GatewayClient();
