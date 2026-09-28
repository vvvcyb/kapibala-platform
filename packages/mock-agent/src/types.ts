export interface ToolSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema: ToolSchema;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface TurnRequest {
  runId: string;
  tools: ToolDefinition[];
  messages: Message[];
}

export interface TurnToolUseResponse {
  stop_reason: 'tool_use';
  content: [ToolUseBlock];
}

export interface TurnEndResponse {
  stop_reason: 'end_turn';
  content: [TextBlock];
}

export type TurnResponse = TurnToolUseResponse | TurnEndResponse;

export interface AuditRequest {
  text: string;
  groupId: string;
}

export interface AuditResponse {
  verdict: 'pass' | 'fail';
  reason: string;
}

export interface TriggerMessage {
  msgId: string;
  senderPlatformUserId: string;
  text: string;
  sentAt: string;
}

export interface TriggerContext {
  groupId: string;
  triggerMessages: TriggerMessage[];
  policy: {
    autoKickEnabled: boolean;
  };
  ownPlatformUserIds: string[];
}
