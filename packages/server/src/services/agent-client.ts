import { config } from '../config.js';
import { AppError } from '../types.js';

export interface AgentTurnResponse {
  stop_reason: 'tool_use' | 'end_turn';
  content: Array<{
    type: 'tool_use' | 'text';
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>;
}

export interface AgentAuditResponse {
  verdict: 'pass' | 'fail';
  reason: string;
}

export class AgentClient {
  private baseUrl: string;

  constructor(baseUrl = config.agentUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async executeTurn(
    runId: string,
    tools: unknown[],
    messages: unknown[],
    timeoutMs = 12000
  ): Promise<{ data: AgentTurnResponse; rawText: string }> {
    const url = `${this.baseUrl}/agent/turn`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let rawText = '';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, tools, messages }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      rawText = await response.text();

      if (!response.ok) {
        throw new AppError(
          response.status,
          'BAD_JSON',
          `Agent service returned status ${response.status}: ${rawText.slice(0, 200)}`,
          { rawText: rawText.slice(0, 2048) }
        );
      }

      // Validate JSON
      let parsed: AgentTurnResponse;
      try {
        parsed = JSON.parse(rawText) as AgentTurnResponse;
      } catch {
        throw new AppError(400, 'BAD_JSON', 'Agent response is not valid JSON', {
          rawText: rawText.slice(0, 2048),
        });
      }

      // SPEC 2.2 / A5: 校验形状 (缺 stop_reason、块数不等于 1、stop_reason 与块类型不一致)
      if (!parsed.stop_reason || !Array.isArray(parsed.content) || parsed.content.length !== 1) {
        throw new AppError(400, 'BAD_JSON', 'Agent response must contain exactly 1 content block and stop_reason', {
          rawText: rawText.slice(0, 2048),
        });
      }

      const block = parsed.content[0];
      if (parsed.stop_reason === 'tool_use' && block.type !== 'tool_use') {
        throw new AppError(400, 'BAD_JSON', 'stop_reason tool_use does not match content block type', {
          rawText: rawText.slice(0, 2048),
        });
      }
      if (parsed.stop_reason === 'end_turn' && block.type !== 'text') {
        throw new AppError(400, 'BAD_JSON', 'stop_reason end_turn does not match content block type', {
          rawText: rawText.slice(0, 2048),
        });
      }

      return { data: parsed, rawText };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new AppError(504, 'TURN_TIMEOUT', 'Agent turn timed out after 12 seconds', {
          rawText: 'TIMEOUT',
        });
      }
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(500, 'BAD_JSON', `Failed to call Agent service: ${(err as Error).message}`, {
        rawText: rawText.slice(0, 2048),
      });
    }
  }

  public async executeAudit(
    text: string,
    groupId: string,
    timeoutMs = 5000
  ): Promise<AgentAuditResponse> {
    const url = `${this.baseUrl}/agent/audit`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, groupId }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = (await response.json()) as AgentAuditResponse;

      if (!response.ok || !data.verdict) {
        throw new AppError(response.status, 'AUDIT_FAILED', 'Audit returned non-200 or missing verdict');
      }

      return data;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new AppError(504, 'AUDIT_TIMEOUT', 'Audit request timed out');
      }
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'AUDIT_ERROR', (err as Error).message);
    }
  }
}

export const agentClient = new AgentClient();
