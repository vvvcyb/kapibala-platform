import { prisma } from '../prisma.js';
import { agentClient } from './agent-client.js';
import { gatewayClient } from './gateway-client.js';
import { messageService } from './message.service.js';
import { websocketService } from './websocket.service.js';

export interface TriggerMessage {
  msgId: string;
  senderPlatformUserId: string;
  text: string;
  sentAt: string;
}

export const AGENT_TOOLS = [
  {
    name: 'get_recent_messages',
    description: 'Get recent group messages',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
      required: ['limit'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to group',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['text', 'idempotency_key'],
    },
  },
  {
    name: 'kick_user',
    description: 'Kick a user from group',
    input_schema: {
      type: 'object',
      properties: {
        platform_user_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['platform_user_id', 'reason'],
    },
  },
  {
    name: 'finish',
    description: 'Finish agent turn',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];

export class AgentRunner {
  // Concurrency lock: groupId -> active runId
  private activeRuns = new Map<string, string>();
  // Backlog messages: groupId -> TriggerMessage[]
  private pendingTriggers = new Map<string, TriggerMessage[]>();

  public async onInboundMessage(message: {
    id: string;
    groupId: string;
    msgId: string | null;
    senderPlatformUserId: string;
    text: string;
    sentAt: Date;
    isOwn: boolean;
  }): Promise<void> {
    // SPEC A5: 服务账号自己的消息不触发 Agent
    if (message.isOwn) return;

    const group = await prisma.group.findUnique({
      where: { id: message.groupId },
    });

    if (!group || !group.agentEnabled || group.status !== 'active') {
      return;
    }

    const triggerMsg: TriggerMessage = {
      msgId: message.msgId || message.id,
      senderPlatformUserId: message.senderPlatformUserId,
      text: message.text,
      sentAt: message.sentAt.toISOString(),
    };

    // Single-instance concurrency lock check
    if (this.activeRuns.has(group.id)) {
      const pending = this.pendingTriggers.get(group.id) || [];
      pending.push(triggerMsg);
      this.pendingTriggers.set(group.id, pending);
      console.log(`[AgentRunner] Group ${group.id} has an active run. Queued trigger message.`);
      return;
    }

    // Launch execution
    this.startRun(group.id, [triggerMsg]).catch((err) => {
      console.error(`[AgentRunner] Run error in group ${group.id}:`, err);
    });
  }

  private async startRun(groupId: string, triggers: TriggerMessage[]): Promise<void> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || !group.agentEnabled || group.status !== 'active') return;

    const run = await prisma.agentRun.create({
      data: {
        groupId,
        status: 'running',
      },
    });

    this.activeRuns.set(groupId, run.id);
    websocketService.notifyAgentRunStarted(run);

    try {
      await this.runLoop(run.id, group, triggers);
    } finally {
      this.activeRuns.delete(groupId);

      // Check for backlogged trigger messages
      const pending = this.pendingTriggers.get(groupId);
      if (pending && pending.length > 0) {
        this.pendingTriggers.delete(groupId);
        console.log(`[AgentRunner] Processing ${pending.length} queued triggers for group ${groupId}...`);
        this.startRun(groupId, pending).catch(console.error);
      }
    }
  }

  private async runLoop(runId: string, group: { id: string; gatewayGroupId: string | null; autoKickEnabled: boolean; agentEnabled: boolean }, triggers: TriggerMessage[]): Promise<void> {
    const startTime = Date.now();
    const maxSteps = 12; // Watchdog 1: 12 steps
    const maxDurationMs = 60000; // Watchdog 2: 60s
    let consecutiveProtocolErrors = 0; // Watchdog 3: 3 consecutive errors

    const usedIdempotencyKeys = new Map<string, { clientMsgId: string; deliveryStatus: string }>();
    const usedToolUseIds = new Set<string>();

    // Initial Trigger Context
    const ownAccounts = await prisma.account.findMany({
      where: { platformUserId: { not: null } },
      select: { platformUserId: true },
    });
    const ownPlatformUserIds = ownAccounts.map((a) => a.platformUserId!).filter(Boolean);

    const triggerContext = {
      groupId: group.id,
      triggerMessages: triggers.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()),
      policy: { autoKickEnabled: group.autoKickEnabled },
      ownPlatformUserIds,
    };

    const messages: Array<{
      role: 'user' | 'assistant';
      content: Array<Record<string, unknown>>;
    }> = [
      {
        role: 'user',
        content: [{ type: 'text', text: JSON.stringify(triggerContext) }],
      },
    ];

    let currentStepIndex = 1;

    while (currentStepIndex <= maxSteps) {
      // 1. Check Watchdog: Time limit
      if (Date.now() - startTime > maxDurationMs) {
        await this.finishRun(runId, 'finished', 'timeout', 'Time limit of 60s exceeded');
        return;
      }

      // 2. Check external state
      const freshGroup = await prisma.group.findUnique({ where: { id: group.id } });
      if (!freshGroup || !freshGroup.agentEnabled || freshGroup.status !== 'active') {
        await this.finishRun(runId, 'cancelled', 'cancelled', 'Group disabled or unreachable');
        return;
      }

      // 3. Call Agent Turn
      let turnResult;
      try {
        turnResult = await agentClient.executeTurn(runId, AGENT_TOOLS, messages, 12000);
      } catch (err: unknown) {
        consecutiveProtocolErrors++;
        const errorObj = err as { code?: string; message?: string; details?: { rawText?: string } };
        const code = errorObj.code || 'BAD_JSON';
        const rawText = errorObj.details?.rawText || errorObj.message || '';

        // Record protocol error step
        await this.recordStep(runId, currentStepIndex, {
          kind: 'protocol_error',
          rawResponse: rawText,
          errorCode: code,
          isError: true,
          resultSummary: `Protocol error: ${code}`,
        });

        // Watchdog 3: 3 consecutive errors
        if (consecutiveProtocolErrors >= 3) {
          await this.finishRun(runId, 'failed', 'protocol_errors', 'Exceeded 3 consecutive protocol errors');
          return;
        }

        // SPEC 2.2 / A5: 追加一条 role: user 的 text 块 PROTOCOL_ERROR
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `PROTOCOL_ERROR ${code}: ${errorObj.message}` }],
        });

        currentStepIndex++;
        continue;
      }

      // Reset consecutive error count on valid turn
      consecutiveProtocolErrors = 0;

      const { data, rawText } = turnResult;
      const block = data.content[0];

      // Check for duplicate tool_use.id
      if (data.stop_reason === 'tool_use' && block.id) {
        if (usedToolUseIds.has(block.id)) {
          consecutiveProtocolErrors++;
          await this.recordStep(runId, currentStepIndex, {
            kind: 'protocol_error',
            rawResponse: rawText,
            errorCode: 'DUPLICATE_TOOL_USE_ID',
            isError: true,
            resultSummary: `Duplicate tool_use id: ${block.id}`,
          });

          if (consecutiveProtocolErrors >= 3) {
            await this.finishRun(runId, 'failed', 'protocol_errors', 'Exceeded 3 consecutive protocol errors');
            return;
          }

          messages.push({
            role: 'user',
            content: [{ type: 'text', text: `PROTOCOL_ERROR DUPLICATE_TOOL_USE_ID: ${block.id}` }],
          });
          currentStepIndex++;
          continue;
        }
        usedToolUseIds.add(block.id);
      }

      // Handle end_turn
      if (data.stop_reason === 'end_turn') {
        const summary = block.text || 'Agent finished turn.';
        await this.recordStep(runId, currentStepIndex, {
          kind: 'final',
          rawResponse: rawText,
          resultSummary: summary.slice(0, 200),
        });
        await this.finishRun(runId, 'finished', 'completed', summary);
        return;
      }

      // Handle tool_use
      const toolName = block.name as string;
      const toolInput = (block.input || {}) as Record<string, unknown>;
      const toolUseId = block.id as string;

      // Check if tool is known
      const toolDef = AGENT_TOOLS.find((t) => t.name === toolName);
      if (!toolDef) {
        // Unknown tool: append assistant block, then tool_result with is_error: true
        messages.push({
          role: 'assistant',
          content: [block],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              is_error: true,
              content: JSON.stringify({ code: 'UNKNOWN_TOOL', message: `Tool ${toolName} is unknown` }),
            },
          ],
        });
        await this.recordStep(runId, currentStepIndex, {
          kind: 'tool_use',
          toolUseId,
          name: toolName,
          input: toolInput,
          isError: true,
          errorCode: 'UNKNOWN_TOOL',
          resultSummary: `Unknown tool: ${toolName}`,
          rawResponse: rawText,
        });
        currentStepIndex++;
        continue;
      }

      // Append assistant message block
      messages.push({
        role: 'assistant',
        content: [block],
      });

      // Execute Tool
      let toolResultContent = '';
      let isToolError = false;
      let toolErrorCode: string | undefined;
      let auditVerdict: string | undefined;

      try {
        if (toolName === 'finish') {
          const summary = (toolInput.summary as string) || 'Completed';
          await this.recordStep(runId, currentStepIndex, {
            kind: 'final',
            toolUseId,
            name: toolName,
            input: toolInput,
            resultSummary: summary.slice(0, 200),
            rawResponse: rawText,
          });
          await this.finishRun(runId, 'finished', 'completed', summary);
          return;
        }

        if (toolName === 'get_recent_messages') {
          const limit = Math.min(Math.max(1, Number(toolInput.limit) || 10), 50);
          const history = await prisma.message.findMany({
            where: { groupId: group.id },
            orderBy: { sentAt: 'desc' },
            take: limit,
          });

          let truncated = false;
          const formatted = history.reverse().map((m) => {
            let text = m.text;
            if (text.length > 500) {
              text = text.slice(0, 500) + '...';
              truncated = true;
            }
            return {
              msgId: m.msgId || m.id,
              senderPlatformUserId: m.senderPlatformUserId,
              isOwn: m.isOwn,
              text,
              sentAt: m.sentAt.toISOString(),
            };
          });

          let jsonStr = JSON.stringify({ messages: formatted, truncated });
          if (jsonStr.length > 8192) {
            jsonStr = jsonStr.slice(0, 8100) + ']}';
          }
          toolResultContent = jsonStr;
        } else if (toolName === 'send_message') {
          const text = String(toolInput.text || '');
          const idempotencyKey = String(toolInput.idempotency_key || '');

          // Idempotency check: if key already used in this run, return cached
          if (usedIdempotencyKeys.has(idempotencyKey)) {
            const cached = usedIdempotencyKeys.get(idempotencyKey)!;
            toolResultContent = JSON.stringify(cached);
          } else {
            // Safety Audit: retry up to 3 times
            const auditResult = await this.performAuditWithRetry(text, group.id);
            auditVerdict = auditResult.verdict;

            if (auditResult.blocked) {
              await this.recordStep(runId, currentStepIndex, {
                kind: 'tool_use',
                toolUseId,
                name: toolName,
                input: toolInput,
                isError: true,
                errorCode: 'AUDIT_BLOCKED',
                auditVerdict: 'blocked',
                resultSummary: 'Audit failed after 3 attempts. Run blocked.',
                rawResponse: rawText,
              });
              await this.finishRun(runId, 'blocked', 'audit_blocked', 'Safety audit unavailable after 3 retries');
              return;
            }

            if (auditVerdict === 'fail') {
              isToolError = true;
              toolErrorCode = 'AUDIT_REJECTED';
              toolResultContent = JSON.stringify({
                code: 'AUDIT_REJECTED',
                message: 'Content rejected by safety audit',
              });
            } else {
              // Pick an online member account
              const members = await prisma.groupMember.findMany({
                where: { groupId: group.id },
                include: { account: true },
              });
              const onlineMember = members.find((m) => m.account.status === 'online');

              if (!onlineMember) {
                isToolError = true;
                toolErrorCode = 'NO_AVAILABLE_ACCOUNT';
                toolResultContent = JSON.stringify({
                  code: 'NO_AVAILABLE_ACCOUNT',
                  message: 'No online accounts available in this group',
                });
              } else {
                const sendRes = await messageService.sendGroupMessage(group.id, onlineMember.accountId, text);
                const resultObj = { clientMsgId: sendRes.clientMsgId, deliveryStatus: 'accepted' };
                usedIdempotencyKeys.set(idempotencyKey, resultObj);
                toolResultContent = JSON.stringify(resultObj);
              }
            }
          }
        } else if (toolName === 'kick_user') {
          const targetPlatformUserId = String(toolInput.platform_user_id || '');
          const reason = String(toolInput.reason || '');

          if (!group.autoKickEnabled) {
            isToolError = true;
            toolErrorCode = 'POLICY_DENIED';
            toolResultContent = JSON.stringify({
              code: 'POLICY_DENIED',
              message: 'autoKickEnabled is disabled for this group',
            });
          } else {
            // Safety Audit: kick_user
            const auditPayload = JSON.stringify({ action: 'kick', platform_user_id: targetPlatformUserId, reason });
            const auditResult = await this.performAuditWithRetry(auditPayload, group.id);
            auditVerdict = auditResult.verdict;

            if (auditResult.blocked) {
              await this.recordStep(runId, currentStepIndex, {
                kind: 'tool_use',
                toolUseId,
                name: toolName,
                input: toolInput,
                isError: true,
                errorCode: 'AUDIT_BLOCKED',
                auditVerdict: 'blocked',
                resultSummary: 'Audit failed after 3 attempts. Run blocked.',
                rawResponse: rawText,
              });
              await this.finishRun(runId, 'blocked', 'audit_blocked', 'Safety audit unavailable after 3 retries');
              return;
            }

            if (auditVerdict === 'fail') {
              isToolError = true;
              toolErrorCode = 'AUDIT_REJECTED';
              toolResultContent = JSON.stringify({
                code: 'AUDIT_REJECTED',
                message: 'Kick action rejected by audit',
              });
            } else {
              // Find an admin or creator online
              const members = await prisma.groupMember.findMany({
                where: {
                  groupId: group.id,
                  role: { in: ['creator', 'admin'] },
                },
                include: { account: true },
              });
              const operator = members.find((m) => m.account.status === 'online');

              if (!operator) {
                isToolError = true;
                toolErrorCode = 'NO_AVAILABLE_ACCOUNT';
                toolResultContent = JSON.stringify({
                  code: 'NO_AVAILABLE_ACCOUNT',
                  message: 'No online creator or admin account to execute kick',
                });
              } else if (!group.gatewayGroupId) {
                isToolError = true;
                toolErrorCode = 'GROUP_UNREACHABLE';
                toolResultContent = JSON.stringify({
                  code: 'GROUP_UNREACHABLE',
                  message: 'Gateway group is not bound',
                });
              } else {
                await gatewayClient.kickMember(group.gatewayGroupId, operator.accountId, targetPlatformUserId);
                toolResultContent = JSON.stringify({ kicked: true });
              }
            }
          }
        }
      } catch (err: unknown) {
        isToolError = true;
        toolErrorCode = (err as { code?: string }).code || 'TOOL_EXECUTION_ERROR';
        toolResultContent = JSON.stringify({
          code: toolErrorCode,
          message: (err as Error).message,
        });
      }

      // Record step in database
      await this.recordStep(runId, currentStepIndex, {
        kind: 'tool_use',
        toolUseId,
        name: toolName,
        input: toolInput,
        resultSummary: toolResultContent.slice(0, 200),
        isError: isToolError,
        errorCode: toolErrorCode,
        auditVerdict,
        rawResponse: rawText,
      });

      // Append user tool_result block
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: toolResultContent,
            ...(isToolError ? { is_error: true } : {}),
          },
        ],
      });

      currentStepIndex++;
    }

    // Step limit reached
    await this.finishRun(runId, 'finished', 'step_limit_exceeded', 'Reached maximum of 12 steps');
  }

  private async performAuditWithRetry(
    text: string,
    groupId: string
  ): Promise<{ verdict: 'pass' | 'fail'; blocked: boolean }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const audit = await agentClient.executeAudit(text, groupId, 4000);
        return { verdict: audit.verdict, blocked: false };
      } catch (err) {
        console.warn(`[AgentRunner] Audit attempt ${attempt + 1} failed:`, err);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    return { verdict: 'fail', blocked: true };
  }

  private async recordStep(
    runId: string,
    index: number,
    data: {
      kind: string;
      toolUseId?: string;
      name?: string;
      input?: Record<string, unknown>;
      resultSummary?: string;
      isError?: boolean;
      errorCode?: string;
      auditVerdict?: string;
      rawResponse?: string;
    }
  ): Promise<void> {
    const step = await prisma.agentRunStep.create({
      data: {
        runId,
        index,
        kind: data.kind,
        toolUseId: data.toolUseId,
        name: data.name,
        input: data.input ? JSON.parse(JSON.stringify(data.input)) : undefined,
        resultSummary: data.resultSummary,
        isError: data.isError || false,
        errorCode: data.errorCode,
        auditVerdict: data.auditVerdict,
        rawResponse: data.rawResponse ? data.rawResponse.slice(0, 2048) : undefined,
      },
    });

    websocketService.notifyAgentRunStep(runId, step);
  }

  private async finishRun(
    runId: string,
    status: 'finished' | 'failed' | 'blocked' | 'cancelled',
    endReason: string,
    summary: string
  ): Promise<void> {
    const updated = await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status,
        endReason,
        summary: summary.slice(0, 500),
      },
      include: { steps: true },
    });

    websocketService.notifyAgentRunFinished(updated);
    console.log(`[AgentRunner] Run ${runId} finished with status=${status}, endReason=${endReason}`);
  }
}

export const agentRunner = new AgentRunner();
