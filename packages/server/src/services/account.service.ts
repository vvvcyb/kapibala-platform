import { AccountStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { gatewayClient } from './gateway-client.js';
import { AppError } from '../types.js';

// SPEC A1: Transition table
const ALLOWED_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  idle: ['online', 'suspended', 'session_expired'],
  online: ['idle', 'rate_limited', 'disconnected', 'suspended', 'session_expired'],
  rate_limited: ['online', 'disconnected', 'suspended', 'session_expired'],
  disconnected: ['idle', 'online', 'suspended', 'session_expired'],
  suspended: [],
  session_expired: [],
};

export class AccountService {
  private rateLimitTimers = new Map<string, NodeJS.Timeout>();

  public isTransitionAllowed(from: AccountStatus, to: AccountStatus): boolean {
    if (from === to) return false;
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  public async getAllAccounts() {
    const accounts = await prisma.account.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        platformUserId: true,
        rateLimitedUntil: true,
        version: true,
      },
    });

    return accounts.map((acc) => ({
      id: acc.id,
      status: acc.status,
      platformUserId: acc.platformUserId,
      rateLimitedUntil: acc.rateLimitedUntil ? acc.rateLimitedUntil.toISOString() : null,
    }));
  }

  public async getAccountById(id: string) {
    return prisma.account.findUnique({
      where: { id },
    });
  }

  public async connectAccount(accountId: string): Promise<{ status: AccountStatus; platformUserId: string }> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
    }

    if (account.status === 'suspended') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Account is permanently suspended');
    }
    if (account.status === 'session_expired') {
      throw new AppError(401, 'SESSION_EXPIRED', 'Account session is permanently expired');
    }

    if (!this.isTransitionAllowed(account.status, 'online')) {
      throw new AppError(
        409,
        'ILLEGAL_TRANSITION',
        `Cannot connect account in status '${account.status}' (transition not allowed)`
      );
    }

    // Call external message gateway connect endpoint
    const gatewayRes = await gatewayClient.connectAccount(accountId);

    // Apply CAS optimistic locking update
    const result = await prisma.account.updateMany({
      where: {
        id: accountId,
        version: account.version,
        status: account.status,
      },
      data: {
        status: 'online',
        platformUserId: gatewayRes.platformUserId,
        rateLimitedUntil: null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new AppError(409, 'CAS_CONFLICT', 'Concurrent modification conflict while connecting account');
    }

    return {
      status: 'online',
      platformUserId: gatewayRes.platformUserId,
    };
  }

  public async transitionAccount(
    accountId: string,
    expectedFrom: AccountStatus,
    to: AccountStatus
  ): Promise<{ status: AccountStatus }> {
    // 1. Check if transition is defined in A1 transition table
    if (!this.isTransitionAllowed(expectedFrom, to)) {
      throw new AppError(
        409,
        'ILLEGAL_TRANSITION',
        `Transition from '${expectedFrom}' to '${to}' is not allowed`
      );
    }

    // 2. Fetch current record to verify expectedFrom and version
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
    }

    if (account.status !== expectedFrom) {
      throw new AppError(
        409,
        'CAS_CONFLICT',
        `Account status is '${account.status}', but expected '${expectedFrom}'`
      );
    }

    // 3. If transitioning to disconnected or idle, notify message gateway
    if (to === 'disconnected' || to === 'idle') {
      try {
        await gatewayClient.disconnectAccount(accountId);
      } catch (err) {
        console.warn(`[Gateway Disconnect] Failed to disconnect ${accountId}:`, err);
      }
    }

    // 4. Perform CAS atomic state transition with consequences in transaction
    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.account.updateMany({
        where: {
          id: accountId,
          version: account.version,
          status: expectedFrom,
        },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === 'online' ? { rateLimitedUntil: null } : {}),
        },
      });

      if (updateResult.count === 0) {
        throw new AppError(409, 'CAS_CONFLICT', 'CAS conflict: account was concurrently updated');
      }

      // 5. SPEC A1: Consequences when entering terminal state
      if (to === 'suspended' || to === 'session_expired') {
        // Remove account from all group memberships
        await tx.groupMember.deleteMany({
          where: { accountId },
        });

        // Cancel all queued messages for this account
        await tx.message.updateMany({
          where: {
            senderPlatformUserId: account.platformUserId || `u_${accountId}`,
            deliveryStatus: 'queued',
          },
          data: {
            deliveryStatus: 'cancelled',
            failCode: 'ACCOUNT_TERMINAL',
          },
        });
      }
    });

    return { status: to };
  }

  public async handleRateLimited(accountId: string, retryAfterSeconds: number): Promise<void> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return;

    if (account.status === 'suspended' || account.status === 'session_expired') {
      return; // Terminal state cannot transition to rate_limited
    }

    const rateLimitedUntil = new Date(Date.now() + retryAfterSeconds * 1000);

    // Update to rate_limited if currently online or refresh rateLimitedUntil
    if (account.status === 'online') {
      await prisma.account.update({
        where: { id: accountId },
        data: {
          status: 'rate_limited',
          rateLimitedUntil,
          version: { increment: 1 },
        },
      });
    } else if (account.status === 'rate_limited') {
      await prisma.account.update({
        where: { id: accountId },
        data: {
          rateLimitedUntil,
        },
      });
    }

    // Clear existing timer if any
    const existingTimer = this.rateLimitTimers.get(accountId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set auto-resume timer
    const timer = setTimeout(async () => {
      this.rateLimitTimers.delete(accountId);
      try {
        const current = await prisma.account.findUnique({ where: { id: accountId } });
        // SPEC A1: 到期时账号已不是 rate_limited 则不做转移
        if (current && current.status === 'rate_limited') {
          await prisma.account.updateMany({
            where: {
              id: accountId,
              status: 'rate_limited',
              version: current.version,
            },
            data: {
              status: 'online',
              rateLimitedUntil: null,
              version: { increment: 1 },
            },
          });
          console.log(`[AccountService] Account ${accountId} rate limit expired, restored to online.`);

          // Trigger processing of queued messages
          const { messageService } = await import('./message.service.js');
          messageService.processQueuedMessagesForAccount(accountId).catch(console.error);
        }
      } catch (err) {
        console.error(`[AccountService] Error resuming rate-limited account ${accountId}:`, err);
      }
    }, retryAfterSeconds * 1000);

    this.rateLimitTimers.set(accountId, timer);
  }

  public async handleTerminalState(accountId: string, status: 'suspended' | 'session_expired'): Promise<void> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return;

    // SPEC A1: 重复进入同一终态时静默忽略，不影响后续事件处理
    if (account.status === status) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          status,
          version: { increment: 1 },
        },
      });

      // Remove from all group memberships
      await tx.groupMember.deleteMany({
        where: { accountId },
      });

      // Cancel queued messages
      await tx.message.updateMany({
        where: {
          senderPlatformUserId: account.platformUserId || `u_${accountId}`,
          deliveryStatus: 'queued',
        },
        data: {
          deliveryStatus: 'cancelled',
          failCode: 'ACCOUNT_TERMINAL',
        },
      });
    });

    console.log(`[AccountService] Account ${accountId} entered terminal state ${status}.`);
  }
}

export const accountService = new AccountService();
