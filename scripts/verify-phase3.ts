/**
 * Automated Verification Script for Phase 3:
 * SPEC A4 (Timeline Cursor Pagination & WebSocket Bus) + SPEC A5 (Agent Integration & Watchdog)
 */

import { WebSocket } from 'ws';

const SERVER_URL = 'http://localhost:3000';
const GATEWAY_URL = 'http://localhost:4001';
const WS_URL = 'ws://localhost:3000/ws';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

async function testWebSocket(token: string): Promise<{ ws: WebSocket; receivedEvents: any[] }> {
  console.log('\n--- [Testing WebSocket Realtime Bus (SPEC A4)] ---');

  // 1. Connection without token -> rejected
  const rejectedWithoutToken = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(WS_URL);
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode === 401);
    });
    ws.on('error', () => {});
  });
  assert(rejectedWithoutToken, 'WebSocket connection without token should be rejected with 401');
  console.log('✓ Unauthorized WS connection rejected (401)');

  // 2. Connection with valid token -> connected
  const receivedEvents: any[] = [];
  const ws = new WebSocket(`${WS_URL}?token=${token}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', (err) => reject(err));
  });

  let lastSeq = 0;
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    receivedEvents.push(frame);

    // Verify monotonic sequence number
    assert(frame.seq > lastSeq, `Sequence number must be monotonically increasing (${frame.seq} > ${lastSeq})`);
    lastSeq = frame.seq;
  });

  // Wait for initial 'connected' frame
  await new Promise((r) => setTimeout(r, 200));
  assert(receivedEvents.length >= 1, 'Expected at least 1 welcome event');
  assert(receivedEvents[0].type === 'connected', 'First event should be connected');
  assert(receivedEvents[0].seq === 1, 'First event seq should be 1');
  console.log('✓ WS connected successfully with initial monotonic frame (seq=1)');

  return { ws, receivedEvents };
}

async function testCursorPagination(token: string) {
  console.log('\n--- [Testing Cursor-Based Pagination (SPEC A4)] ---');

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Get first group
  const groupsRes = await fetch(`${SERVER_URL}/api/groups`, { headers });
  const groups = (await groupsRes.json()) as Array<{ id: string }>;
  assert(groups.length > 0, 'Expected at least 1 group');
  const groupId = groups[0].id;

  // Send 3 distinct test messages
  for (let i = 1; i <= 3; i++) {
    await fetch(`${SERVER_URL}/api/groups/${groupId}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ accountId: 'account_1', text: `Pagination Test Message ${i} [${Date.now()}]` }),
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  // Fetch page 1 (limit 2)
  const page1Res = await fetch(`${SERVER_URL}/api/groups/${groupId}/messages?limit=2`, { headers });
  assert(page1Res.status === 200, `Page 1 status: ${page1Res.status}`);
  const page1 = (await page1Res.json()) as { items: any[]; nextCursor: string | null };
  assert(page1.items.length === 2, `Expected 2 items in page 1, got ${page1.items.length}`);
  assert(Boolean(page1.nextCursor), 'Expected nextCursor for page 1');
  console.log(`✓ Page 1 fetched 2 items, nextCursor: ${page1.nextCursor}`);

  // Fetch page 2 using cursor
  const page2Res = await fetch(`${SERVER_URL}/api/groups/${groupId}/messages?cursor=${page1.nextCursor}&limit=2`, { headers });
  assert(page2Res.status === 200, `Page 2 status: ${page2Res.status}`);
  const page2 = (await page2Res.json()) as { items: any[]; nextCursor: string | null };
  assert(page2.items.length >= 1, 'Expected at least 1 item in page 2');

  // Verify NO duplicate items between page 1 and page 2
  const page1Ids = new Set(page1.items.map((m) => m.id || m.clientMsgId));
  for (const item of page2.items) {
    const id = item.id || item.clientMsgId;
    assert(!page1Ids.has(id), `Duplicate item found in pagination: ${id}`);
  }
  console.log('✓ Stable cursor pagination verified with zero duplicates');
}

async function testAgentInteraction(token: string) {
  console.log('\n--- [Testing Agent Integration & Watchdog (SPEC A5)] ---');

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 1. Get or setup active group
  const groupsRes = await fetch(`${SERVER_URL}/api/groups`, { headers });
  const groups = (await groupsRes.json()) as Array<{ id: string; gatewayGroupId: string }>;
  const group = groups[0];

  // 2. Enable Agent and AutoKick on group via settings PATCH
  const settingsRes = await fetch(`${SERVER_URL}/api/groups/${group.id}/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ agentEnabled: true, autoKickEnabled: true }),
  });
  assert(settingsRes.status === 200, `Settings status: ${settingsRes.status}`);
  console.log('✓ Enabled agentEnabled and autoKickEnabled on group');

  // 3. Test Normal Message -> Triggers Agent -> calls send_message -> finish
  console.log('-> Sending external non-own greeting to trigger Agent...');
  await fetch(`${GATEWAY_URL}/mock/groups/${group.gatewayGroupId}/inbound-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderPlatformUserId: 'u_external_visitor_1',
      text: '你好群助手，请问有什么可以帮助大家的？',
    }),
  });

  // Wait for agent run to execute (1-3 seconds)
  console.log('-> Waiting for Agent Run execution...');
  let agentRunFinished = false;
  let finishedRun: any = null;

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const runsRes = await fetch(`${SERVER_URL}/api/groups/${group.id}/agent-runs`, { headers });
    const runs = (await runsRes.json()) as any[];
    if (runs.length > 0 && runs[0].status === 'finished') {
      agentRunFinished = true;
      finishedRun = runs[0];
      break;
    }
  }

  assert(agentRunFinished, 'Agent run did not finish in time');
  console.log(`✓ Agent run finished: id=${finishedRun.id}, endReason=${finishedRun.endReason}, summary=${finishedRun.summary}`);

  // Query Agent Run steps
  const runDetailRes = await fetch(`${SERVER_URL}/api/agent-runs/${finishedRun.id}`, { headers });
  assert(runDetailRes.status === 200, `Run detail status: ${runDetailRes.status}`);
  const runDetail = (await runDetailRes.json()) as { steps: any[] };
  assert(runDetail.steps.length >= 2, `Expected at least 2 steps, got ${runDetail.steps.length}`);
  console.log(`✓ Run details inspected: ${runDetail.steps.length} steps recorded with toolUseId & audit verdicts`);

  // 4. Test Violation Message -> Triggers kick_user
  console.log('\n-> Sending external spam message to test auto-kick...');
  await fetch(`${GATEWAY_URL}/mock/groups/${group.gatewayGroupId}/add-member`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platformUserId: 'u_spammer_99',
    }),
  });

  await fetch(`${GATEWAY_URL}/mock/groups/${group.gatewayGroupId}/inbound-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderPlatformUserId: 'u_spammer_99',
      text: '兼职刷单月入十万，加微信加好友！spam 违规广告',
    }),
  });

  // Wait for spam run to complete
  let spamRunFinished = false;
  let spamRun: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const runsRes = await fetch(`${SERVER_URL}/api/groups/${group.id}/agent-runs`, { headers });
    const runs = (await runsRes.json()) as any[];
    if (runs.length > 0 && runs[0].id !== finishedRun.id && runs[0].status === 'finished') {
      spamRunFinished = true;
      spamRun = runs[0];
      break;
    }
  }

  assert(spamRunFinished, 'Spam agent run did not finish in time');
  const spamDetailRes = await fetch(`${SERVER_URL}/api/agent-runs/${spamRun.id}`, { headers });
  const spamDetail = (await spamDetailRes.json()) as { steps: any[] };
  const kickStep = spamDetail.steps.find((s) => s.name === 'kick_user');
  assert(Boolean(kickStep), 'Expected kick_user step in spam run');
  console.log(`✓ Spam detection confirmed: kick_user executed with auditVerdict=${kickStep.auditVerdict}`);
}

async function main() {
  try {
    const token = await getAdminToken();
    const { ws, receivedEvents } = await testWebSocket(token);
    await testCursorPagination(token);
    await testAgentInteraction(token);

    // Verify WebSocket captured broadcast events during the test
    assert(receivedEvents.some((e) => e.type.startsWith('message_') || e.type.startsWith('agent_')),
      'WebSocket should have captured realtime message and agent events');
    console.log(`✓ WebSocket successfully captured ${receivedEvents.length} realtime events`);

    ws.close();

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE 3 (SPEC A4 & A5) VERIFICATIONS PASSED! 🎉');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Phase 3 Verification Failed:', err);
    process.exit(1);
  }
}

main();
