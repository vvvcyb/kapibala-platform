import { prisma } from '../prisma.js';
import { gatewayClient } from './gateway-client.js';
import { AppError } from '../types.js';

export class GroupService {
  // Listener map for waiting for member_joined SSE event
  private memberJoinedWaiters = new Map<string, (val: boolean) => void>();

  public onMemberJoinedEvent(gatewayGroupId: string, platformUserId: string): void {
    const key = `${gatewayGroupId}:${platformUserId}`;
    const waiter = this.memberJoinedWaiters.get(key);
    if (waiter) {
      waiter(true);
      this.memberJoinedWaiters.delete(key);
    }
  }

  private waitForMemberJoined(gatewayGroupId: string, platformUserId: string, timeoutMs = 10000): Promise<boolean> {
    return new Promise((resolve) => {
      const key = `${gatewayGroupId}:${platformUserId}`;
      const timer = setTimeout(() => {
        this.memberJoinedWaiters.delete(key);
        resolve(false);
      }, timeoutMs);

      this.memberJoinedWaiters.set(key, (success: boolean) => {
        clearTimeout(timer);
        resolve(success);
      });
    });
  }

  public async startCreateGroupJob(creatorAccountId: string, memberAccountIds: string[]): Promise<string> {
    // 1. Validation per SPEC A3
    if (!creatorAccountId || !Array.isArray(memberAccountIds) || memberAccountIds.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'creatorAccountId and at least one memberAccountId are required');
    }

    if (memberAccountIds.includes(creatorAccountId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'memberAccountIds must not contain creatorAccountId');
    }

    // 2. Validate all accounts must be online
    const allAccountIds = [creatorAccountId, ...memberAccountIds];
    const accounts = await prisma.account.findMany({
      where: { id: { in: allAccountIds } },
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    for (const id of allAccountIds) {
      const acc = accountMap.get(id);
      if (!acc || acc.status !== 'online') {
        throw new AppError(422, 'ACCOUNT_NOT_ONLINE', `Account ${id} is not online (status: ${acc?.status || 'missing'})`);
      }
    }

    // 3. Create Job in database
    const job = await prisma.job.create({
      data: {
        type: 'create_group',
        status: 'running',
        progress: 10,
        step: 'init',
        payload: { creatorAccountId, memberAccountIds },
      },
    });

    // 4. Asynchronously execute the workflow
    this.executeCreateGroupWorkflow(job.id, creatorAccountId, memberAccountIds).catch(async (err) => {
      console.error(`[GroupService] Job ${job.id} failed unexpectedly:`, err);
    });

    return job.id;
  }

  private async executeCreateGroupWorkflow(
    jobId: string,
    creatorAccountId: string,
    memberAccountIds: string[]
  ): Promise<void> {
    let currentStep = 'create';
    try {
      // Step 1: Create Group on Gateway
      await prisma.job.update({ where: { id: jobId }, data: { step: 'create', progress: 20 } });
      const { groupId: gatewayGroupId } = await gatewayClient.createGroup(creatorAccountId);

      // Save Group in DB
      const group = await prisma.group.create({
        data: {
          gatewayGroupId,
          creatorAccountId,
          status: 'active',
          agentEnabled: false,
          autoKickEnabled: false,
        },
      });

      // Creator is immediately member with role = creator
      const creatorPlatformUserId = `u_${creatorAccountId}`;
      await prisma.groupMember.create({
        data: {
          groupId: group.id,
          accountId: creatorAccountId,
          platformUserId: creatorPlatformUserId,
          role: 'creator',
        },
      });

      // Step 2: Get Invite Link
      currentStep = 'invite';
      await prisma.job.update({ where: { id: jobId }, data: { step: 'invite', progress: 40 } });

      let inviteLink: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const invRes = await gatewayClient.createInvite(gatewayGroupId, 0);
          if (invRes.readyAfterMs > 0) {
            await new Promise((r) => setTimeout(r, invRes.readyAfterMs));
          }
          inviteLink = invRes.inviteLink;
          break;
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code === 'INVITE_EXPIRED' && attempt === 0) {
            continue; // Retry once
          }
          throw err;
        }
      }

      if (!inviteLink) {
        throw new AppError(500, 'INVITE_FAILED', 'Failed to obtain a valid invite link');
      }

      // Step 3: Join each member
      let joinedCount = 0;
      for (const memberAccountId of memberAccountIds) {
        currentStep = `join:${memberAccountId}`;
        await prisma.job.update({
          where: { id: jobId },
          data: {
            step: currentStep,
            progress: 40 + Math.floor((30 * joinedCount) / memberAccountIds.length),
          },
        });

        const targetPlatformUserId = `u_${memberAccountId}`;

        try {
          await gatewayClient.joinGroup(gatewayGroupId, memberAccountId, inviteLink);
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code !== 'ALREADY_MEMBER') {
            throw err;
          }
        }

        // Wait for member_joined event from SSE stream (up to 10s)
        const joined = await this.waitForMemberJoined(gatewayGroupId, targetPlatformUserId, 10000);
        if (!joined) {
          throw new AppError(504, 'JOIN_TIMEOUT', `Timed out waiting for member_joined event for ${memberAccountId}`);
        }

        // Add to GroupMember in DB
        await prisma.groupMember.upsert({
          where: {
            groupId_accountId: {
              groupId: group.id,
              accountId: memberAccountId,
            },
          },
          update: {},
          create: {
            groupId: group.id,
            accountId: memberAccountId,
            platformUserId: targetPlatformUserId,
            role: 'member',
          },
        });

        joinedCount++;
      }

      // Step 4: Promote memberAccountIds[0] to admin
      currentStep = 'promote';
      await prisma.job.update({ where: { id: jobId }, data: { step: 'promote', progress: 85 } });
      const firstMemberId = memberAccountIds[0];
      await gatewayClient.promoteMember(gatewayGroupId, creatorAccountId, firstMemberId);

      await prisma.groupMember.update({
        where: {
          groupId_accountId: {
            groupId: group.id,
            accountId: firstMemberId,
          },
        },
        data: {
          role: 'admin',
        },
      });

      // Step 5: Mark Job as completed
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          progress: 100,
          step: 'completed',
          result: { groupId: group.id, gatewayGroupId },
        },
      });

      console.log(`[GroupService] Job ${jobId} finished successfully. Group created: ${group.id}`);
    } catch (err: unknown) {
      console.error(`[GroupService] Job ${jobId} failed at step ${currentStep}:`, err);
      const errorObj = err as { code?: string; message?: string };
      const code = errorObj.code || 'JOB_FAILED';
      const message = errorObj.message || 'An error occurred during group creation';

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          step: currentStep,
          error: `${currentStep}: ${code} - ${message}`,
          errors: [{ step: currentStep, code }],
        },
      });
    }
  }

  public async getJobById(jobId: string) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', `Job ${jobId} does not exist`);
    }

    // SPEC 2.3 format: { status: running | finished | failed, errors: [{ step, code }] }
    let status: 'running' | 'finished' | 'failed' = 'running';
    if (job.status === 'completed') status = 'finished';
    else if (job.status === 'failed') status = 'failed';
    else status = 'running';

    const errors = (job.errors as Array<{ step: string; code: string }>) || [];

    return {
      status,
      errors,
      result: job.result,
    };
  }

  public async getGroups() {
    const groups = await prisma.group.findMany({
      include: {
        members: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((g) => ({
      id: g.id,
      gatewayGroupId: g.gatewayGroupId,
      status: g.status,
      creatorAccountId: g.creatorAccountId,
      agentEnabled: g.agentEnabled,
      autoKickEnabled: g.autoKickEnabled,
      members: g.members.map((m) => ({
        accountId: m.accountId,
        platformUserId: m.platformUserId,
        role: m.role,
      })),
      activeSequenceRunId: null,
      activeAgentRunId: null,
    }));
  }

  public async getGroupById(groupId: string) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: true,
      },
    });

    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', `Group ${groupId} not found`);
    }

    return {
      id: group.id,
      gatewayGroupId: group.gatewayGroupId,
      status: group.status,
      creatorAccountId: group.creatorAccountId,
      agentEnabled: group.agentEnabled,
      autoKickEnabled: group.autoKickEnabled,
      members: group.members.map((m) => ({
        accountId: m.accountId,
        platformUserId: m.platformUserId,
        role: m.role,
      })),
      activeSequenceRunId: null,
      activeAgentRunId: null,
    };
  }

  public async updateGroupConfig(groupId: string, data: { agentEnabled?: boolean; autoKickEnabled?: boolean }) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', `Group ${groupId} not found`);
    }

    return prisma.group.update({
      where: { id: groupId },
      data: {
        ...(data.agentEnabled !== undefined ? { agentEnabled: data.agentEnabled } : {}),
        ...(data.autoKickEnabled !== undefined ? { autoKickEnabled: data.autoKickEnabled } : {}),
      },
    });
  }
}

export const groupService = new GroupService();
