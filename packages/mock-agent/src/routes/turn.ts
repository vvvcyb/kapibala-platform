import { Router, Request, Response } from 'express';
import {
  TurnRequest,
  TurnResponse,
  ToolDefinition,
  TriggerContext,
  ToolResultBlock,
  ToolUseBlock,
} from '../types.js';

export const turnRouter = Router();

// Validate tools according to SPEC 2.2
function validateTools(tools: ToolDefinition[]): boolean {
  if (!Array.isArray(tools) || tools.length !== 4) {
    return false;
  }

  const toolMap = new Map<string, ToolDefinition>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }

  // 1. get_recent_messages: { limit: number }
  const getRecent = toolMap.get('get_recent_messages');
  if (!getRecent || !getRecent.input_schema?.required?.includes('limit')) {
    return false;
  }

  // 2. send_message: { text: string, idempotency_key: string }
  const sendMsg = toolMap.get('send_message');
  if (
    !sendMsg ||
    !sendMsg.input_schema?.required?.includes('text') ||
    !sendMsg.input_schema?.required?.includes('idempotency_key')
  ) {
    return false;
  }

  // 3. kick_user: { platform_user_id: string, reason: string }
  const kickUser = toolMap.get('kick_user');
  if (
    !kickUser ||
    !kickUser.input_schema?.required?.includes('platform_user_id') ||
    !kickUser.input_schema?.required?.includes('reason')
  ) {
    return false;
  }

  // 4. finish: { summary: string }
  const finish = toolMap.get('finish');
  if (!finish || !finish.input_schema?.required?.includes('summary')) {
    return false;
  }

  return true;
}

turnRouter.post('/', async (req: Request, res: Response) => {
  const { runId, tools, messages } = req.body as TurnRequest;

  // Simulation header override: delay
  const mockDelay = Number(req.headers['x-mock-delay'] || 0);
  if (mockDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockDelay));
  }

  // Simulation header override: status
  const mockStatus = req.headers['x-mock-status'];
  if (mockStatus) {
    return res.status(Number(mockStatus)).json({
      error: { code: 'MOCK_ERROR', message: `Simulated error ${mockStatus}` },
    });
  }

  // Simulation header override: bad json (SPEC 2.2: markdown code fence or bad string)
  const mockBadJson = req.headers['x-mock-bad-json'];
  if (mockBadJson) {
    res.setHeader('Content-Type', 'application/json');
    return res.send('```json\n{"stop_reason": "end_turn", "content": [{"type": "text", "text": "bad json"}]}\n```');
  }

  // 1. Tool validation
  if (!validateTools(tools)) {
    return res.status(400).json({
      error: {
        code: 'TOOLS_INVALID',
        message: 'Tools must match the 4 required tools with proper input_schema',
      },
    });
  }

  // Simulation header override: unknown tool
  if (req.headers['x-mock-unknown-tool']) {
    const unknownResp: TurnResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: `tu_${Math.random().toString(36).slice(2, 9)}`,
          name: 'unknown_magic_tool',
          input: { magic: true },
        },
      ],
    };
    return res.status(200).json(unknownResp);
  }

  // 2. Parse trigger context from messages[0]
  let triggerContext: TriggerContext | null = null;
  if (Array.isArray(messages) && messages.length > 0) {
    const firstMsg = messages[0];
    if (firstMsg.role === 'user' && Array.isArray(firstMsg.content)) {
      const textBlock = firstMsg.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        try {
          triggerContext = JSON.parse(textBlock.text) as TriggerContext;
        } catch {
          // not valid json
        }
      }
    }
  }

  // Check last message
  const lastMsg = messages[messages.length - 1];
  const lastToolResult =
    lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)
      ? (lastMsg.content.find((b) => b.type === 'tool_result') as ToolResultBlock | undefined)
      : undefined;

  const toolUseId =
    req.headers['x-mock-duplicate-tool-id'] ? 'tu_fixed_id' : `tu_${Math.random().toString(36).slice(2, 9)}`;

  // Multi-turn simulation logic:
  // If last message was a tool_result:
  if (lastToolResult) {
    // Find preceding assistant tool_use
    let prevToolName = '';
    for (let i = messages.length - 2; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const tu = msg.content.find((b) => b.type === 'tool_use') as ToolUseBlock | undefined;
        if (tu) {
          prevToolName = tu.name;
          break;
        }
      }
    }

    if (prevToolName === 'finish') {
      // Finished!
      const endResponse: TurnResponse = {
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: 'Turn completed',
          },
        ],
      };
      return res.status(200).json(endResponse);
    }

    // After send_message or kick_user succeeds (or fails), call finish
    const finishResponse: TurnResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'finish',
          input: {
            summary: `Successfully executed ${prevToolName || 'tool'} and completed turn.`,
          },
        },
      ],
    };
    return res.status(200).json(finishResponse);
  }

  // First turn:
  const triggerMsg = triggerContext?.triggerMessages?.[0];
  const triggerText = triggerMsg?.text || '';
  const senderId = triggerMsg?.senderPlatformUserId || 'u_unknown';

  // Check for spam or violation
  const isSpam = /spam|广告|违规|kick|诈骗|兼职|菠菜|赌博|加微/i.test(triggerText);

  if (isSpam) {
    const kickResponse: TurnResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'kick_user',
          input: {
            platform_user_id: senderId,
            reason: 'Detected spam or advertising violation',
          },
        },
      ],
    };
    return res.status(200).json(kickResponse);
  }

  // Normal message -> call send_message
  const idempotencyKey =
    req.headers['x-mock-retry-same-key'] ? 'k_reused_key' : `k_${runId}_${Date.now()}`;

  const sendResponse: TurnResponse = {
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: 'send_message',
        input: {
          text: `你好！我是群助手，收到你的消息：“${triggerText}”，正在为你处理。`,
          idempotency_key: idempotencyKey,
        },
      },
    ],
  };

  return res.status(200).json(sendResponse);
});
