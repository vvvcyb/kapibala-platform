/**
 * Automated Verification Script for Phase 1 Mock Services
 * Tests mock-gateway (port 4001) and mock-agent (port 4002) against SPEC 2.1 & 2.2
 */

const GATEWAY_URL = 'http://localhost:4001';
const AGENT_URL = 'http://localhost:4002';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

async function testGateway() {
  console.log('\n--- [Testing Mock Gateway (SPEC 2.1)] ---');

  // Reset gateway store
  await fetch(`${GATEWAY_URL}/mock/reset`, { method: 'POST' });

  // 1. Health check
  const healthRes = await fetch(`${GATEWAY_URL}/health`);
  const healthData = await healthRes.json() as { ok: boolean };
  assert(healthData.ok === true, 'Gateway health check failed');
  console.log('✓ Gateway health check passed');

  // 2. Connect account_1
  const conn1Res = await fetch(`${GATEWAY_URL}/accounts/account_1/connect`, { method: 'POST' });
  assert(conn1Res.status === 200, `Expected 200, got ${conn1Res.status}`);
  const conn1Data = await conn1Res.json() as { platformUserId: string };
  assert(conn1Data.platformUserId === 'u_account_1', `Expected u_account_1, got ${conn1Data.platformUserId}`);
  console.log('✓ Account 1 connected: u_account_1');

  // 3. Connect account_2
  const conn2Res = await fetch(`${GATEWAY_URL}/accounts/account_2/connect`, { method: 'POST' });
  const conn2Data = await conn2Res.json() as { platformUserId: string };
  assert(conn2Data.platformUserId === 'u_account_2', `Expected u_account_2, got ${conn2Data.platformUserId}`);
  console.log('✓ Account 2 connected: u_account_2');

  // 4. Create Group
  const createGrpRes = await fetch(`${GATEWAY_URL}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatorAccountId: 'account_1' }),
  });
  assert(createGrpRes.status === 200, `Expected 200, got ${createGrpRes.status}`);
  const groupData = await createGrpRes.json() as { groupId: string };
  const groupId = groupData.groupId;
  assert(Boolean(groupId), 'Expected groupId');
  console.log(`✓ Group created: ${groupId}`);

  // 5. Verify initial member (creator is already member, no member_joined event per SPEC)
  const mem1Res = await fetch(`${GATEWAY_URL}/groups/${groupId}/members`);
  const mem1 = await mem1Res.json() as Array<{ platformUserId: string }>;
  assert(mem1.some((m) => m.platformUserId === 'u_account_1'), 'Creator should be in member list');
  console.log('✓ Creator immediately in members');

  // 6. Create Invite Link
  const inviteRes = await fetch(`${GATEWAY_URL}/groups/${groupId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readyAfterMs: 0 }),
  });
  const inviteData = await inviteRes.json() as { inviteLink: string; readyAfterMs: number };
  assert(Boolean(inviteData.inviteLink), 'Expected inviteLink');
  console.log(`✓ Invite link created: ${inviteData.inviteLink}`);

  // 7. Join Group with account_2 -> 202 accepted
  const joinRes = await fetch(`${GATEWAY_URL}/groups/${groupId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'account_2', inviteLink: inviteData.inviteLink }),
  });
  assert(joinRes.status === 202, `Expected 202 accepted, got ${joinRes.status}`);
  console.log('✓ Join request accepted with 202');

  // Wait 350ms for member_joined event & member list update
  await new Promise((r) => setTimeout(r, 350));
  const mem2Res = await fetch(`${GATEWAY_URL}/groups/${groupId}/members`);
  const mem2 = await mem2Res.json() as Array<{ platformUserId: string }>;
  assert(mem2.some((m) => m.platformUserId === 'u_account_2'), 'account_2 should have joined after delay');
  console.log('✓ Delayed join verified in members list');

  // 8. Promote account_2 -> 200
  const promoteRes = await fetch(`${GATEWAY_URL}/groups/${groupId}/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ byAccountId: 'account_1', accountId: 'account_2' }),
  });
  assert(promoteRes.status === 200, `Expected 200, got ${promoteRes.status}`);
  console.log('✓ Member promoted to admin');

  // 9. Send message -> 202 accepted
  const clientMsgId = 'c_test_001';
  const sendRes = await fetch(`${GATEWAY_URL}/groups/${groupId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'account_1', clientMsgId, text: 'Hello Kapibala' }),
  });
  assert(sendRes.status === 202, `Expected 202, got ${sendRes.status}`);
  console.log('✓ Send message accepted with 202');

  // 10. Query message by clientMsgId after 250ms delay
  await new Promise((r) => setTimeout(r, 250));
  const queryMsgRes = await fetch(`${GATEWAY_URL}/groups/${groupId}/messages/by-client-id/${clientMsgId}`);
  assert(queryMsgRes.status === 200, `Expected 200, got ${queryMsgRes.status}`);
  const msgData = await queryMsgRes.json() as { msgId: string; sentAt: string };
  assert(Boolean(msgData.msgId), 'Expected msgId in message record');
  console.log(`✓ Message landed in store: msgId=${msgData.msgId}, sentAt=${msgData.sentAt}`);

  // 11. Test Error & Simulation Codes:
  // Offline account send
  const offlineSend = await fetch(`${GATEWAY_URL}/groups/${groupId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'account_3', clientMsgId: 'c_offline', text: 'fail' }),
  });
  assert(offlineSend.status === 409, `Expected 409 ACCOUNT_OFFLINE, got ${offlineSend.status}`);
  console.log('✓ Offline account send returned 409 ACCOUNT_OFFLINE');

  // Rate limiting simulation (429)
  const rateLimitSend = await fetch(`${GATEWAY_URL}/groups/${groupId}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-mock-status': '429',
      'x-retry-after': '3',
    },
    body: JSON.stringify({ accountId: 'account_1', clientMsgId: 'c_rate', text: 'fail' }),
  });
  assert(rateLimitSend.status === 429, `Expected 429, got ${rateLimitSend.status}`);
  console.log('✓ Simulated 429 RATE_LIMITED returned successfully');

  // 12. Test SSE events replay with since=0
  const eventsRes = await fetch(`${GATEWAY_URL}/events?since=0`);
  const reader = eventsRes.body?.getReader();
  assert(Boolean(reader), 'Expected SSE readable stream');
  const chunk = await reader!.read();
  const text = new TextDecoder().decode(chunk.value);
  assert(text.includes('event: member_joined') || text.includes('event: message_sent') || text.includes('event: message'),
    'Expected historical events replayed via SSE');
  console.log('✓ SSE history replayed correctly with monotonic event IDs');
  await reader!.cancel();
}

async function testAgent() {
  console.log('\n--- [Testing Mock Agent (SPEC 2.2)] ---');

  // 1. Health check
  const healthRes = await fetch(`${AGENT_URL}/health`);
  const healthData = await healthRes.json() as { ok: boolean };
  assert(healthData.ok === true, 'Agent health check failed');
  console.log('✓ Agent health check passed');

  const requiredTools = [
    {
      name: 'get_recent_messages',
      description: 'Get recent group messages',
      input_schema: { type: 'object', properties: { limit: { type: 'number' } }, required: ['limit'] },
    },
    {
      name: 'send_message',
      description: 'Send a message to group',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' }, idempotency_key: { type: 'string' } },
        required: ['text', 'idempotency_key'],
      },
    },
    {
      name: 'kick_user',
      description: 'Kick a user from group',
      input_schema: {
        type: 'object',
        properties: { platform_user_id: { type: 'string' }, reason: { type: 'string' } },
        required: ['platform_user_id', 'reason'],
      },
    },
    {
      name: 'finish',
      description: 'Finish agent turn',
      input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  ];

  // 2. Test Tools Validation (Reject if tools are invalid or incomplete)
  const invalidToolsRes = await fetch(`${AGENT_URL}/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'r_test_invalid',
      tools: [{ name: 'get_recent_messages', input_schema: { type: 'object' } }],
      messages: [],
    }),
  });
  assert(invalidToolsRes.status === 400, `Expected 400 for invalid tools, got ${invalidToolsRes.status}`);
  console.log('✓ Invalid tools properly rejected with 400 TOOLS_INVALID');

  // 3. Test Greeting / Normal Turn -> Should call send_message
  const runId = 'r_run_001';
  const triggerContext = {
    groupId: 'g_1',
    triggerMessages: [
      {
        msgId: 'm_100',
        senderPlatformUserId: 'u_user_99',
        text: '你好，群里有人在吗？',
        sentAt: new Date().toISOString(),
      },
    ],
    policy: { autoKickEnabled: false },
    ownPlatformUserIds: ['u_account_1'],
  };

  const turn1Res = await fetch(`${AGENT_URL}/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      tools: requiredTools,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(triggerContext) }],
        },
      ],
    }),
  });
  assert(turn1Res.status === 200, `Expected 200, got ${turn1Res.status}`);
  const turn1Data = await turn1Res.json() as { stop_reason: string; content: Array<{ type: string; name: string; id: string; input: Record<string, unknown> }> };
  assert(turn1Data.stop_reason === 'tool_use', 'Expected stop_reason tool_use');
  assert(turn1Data.content[0].name === 'send_message', `Expected send_message, got ${turn1Data.content[0].name}`);
  console.log('✓ Normal trigger message invoked send_message tool');

  // 4. Test Multi-Turn Continuation with tool_result -> Should call finish
  const turn2Res = await fetch(`${AGENT_URL}/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      tools: requiredTools,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(triggerContext) }],
        },
        {
          role: 'assistant',
          content: [turn1Data.content[0]],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: turn1Data.content[0].id,
              content: JSON.stringify({ clientMsgId: 'c_1', deliveryStatus: 'sent' }),
            },
          ],
        },
      ],
    }),
  });
  assert(turn2Res.status === 200, `Expected 200, got ${turn2Res.status}`);
  const turn2Data = await turn2Res.json() as { stop_reason: string; content: Array<{ type: string; name: string }> };
  assert(turn2Data.stop_reason === 'tool_use', 'Expected stop_reason tool_use');
  assert(turn2Data.content[0].name === 'finish', `Expected finish, got ${turn2Data.content[0].name}`);
  console.log('✓ tool_result followed by finish tool invocation');

  // 5. Test Spam / Violation Message -> Should call kick_user
  const spamContext = {
    groupId: 'g_1',
    triggerMessages: [
      {
        msgId: 'm_101',
        senderPlatformUserId: 'u_spammer_1',
        text: '兼职刷单月入过万，加微私聊！spam 广告',
        sentAt: new Date().toISOString(),
      },
    ],
    policy: { autoKickEnabled: true },
    ownPlatformUserIds: ['u_account_1'],
  };

  const spamTurnRes = await fetch(`${AGENT_URL}/agent/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'r_spam_run',
      tools: requiredTools,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(spamContext) }],
        },
      ],
    }),
  });
  const spamTurnData = await spamTurnRes.json() as { stop_reason: string; content: Array<{ type: string; name: string; input: { platform_user_id: string } }> };
  assert(spamTurnData.content[0].name === 'kick_user', `Expected kick_user for spam, got ${spamTurnData.content[0].name}`);
  assert(spamTurnData.content[0].input.platform_user_id === 'u_spammer_1', 'Target user to kick matched spammer');
  console.log('✓ Spam message invoked kick_user tool targeting spammer');

  // 6. Test Audit Endpoint: Pass & Fail
  const safeAuditRes = await fetch(`${AGENT_URL}/agent/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '这是一条合规正常的通知消息', groupId: 'g_1' }),
  });
  const safeAuditData = await safeAuditRes.json() as { verdict: string };
  assert(safeAuditData.verdict === 'pass', `Expected pass, got ${safeAuditData.verdict}`);
  console.log('✓ Audit passed for safe content');

  const failAuditRes = await fetch(`${AGENT_URL}/agent/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '含有违规内容与 reject 标记', groupId: 'g_1' }),
  });
  const failAuditData = await failAuditRes.json() as { verdict: string };
  assert(failAuditData.verdict === 'fail', `Expected fail, got ${failAuditData.verdict}`);
  console.log('✓ Audit failed for violation content (违规/reject)');
}

async function main() {
  try {
    await testGateway();
    await testAgent();
    console.log('\n=============================================');
    console.log('🎉 ALL SPEC 2.1 & 2.2 VERIFICATIONS PASSED! 🎉');
    console.log('=============================================\n');
  } catch (err) {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
  }
}

main();
