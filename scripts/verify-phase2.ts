/**
 * Automated Verification Script for Phase 2: Core Server & State Machine (A0 ~ A3)
 */

const SERVER_URL = 'http://localhost:3000';
const GATEWAY_URL = 'http://localhost:4001';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

async function testA0AuthAndHealth() {
  console.log('\n--- [Testing SPEC A0: Auth & Health] ---');

  // 1. Health check
  const healthRes = await fetch(`${SERVER_URL}/api/health`);
  assert(healthRes.status === 200, `Health check status: ${healthRes.status}`);
  const health = await healthRes.json() as { ok: boolean; schemaVersion: string };
  assert(health.ok === true, 'Health ok must be true');
  assert(health.schemaVersion === '1.0.0', 'Health schemaVersion must be 1.0.0');
  console.log('✓ Health check passed');

  // 2. Admin login
  const adminLoginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  assert(adminLoginRes.status === 200, `Admin login status: ${adminLoginRes.status}`);
  const adminAuth = await adminLoginRes.json() as { accessToken: string };
  assert(Boolean(adminAuth.accessToken), 'Expected admin accessToken');
  console.log('✓ Admin login successful');

  // 3. Viewer login
  const viewerLoginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: 'viewer' }),
  });
  assert(viewerLoginRes.status === 200, `Viewer login status: ${viewerLoginRes.status}`);
  const viewerAuth = await viewerLoginRes.json() as { accessToken: string };
  assert(Boolean(viewerAuth.accessToken), 'Expected viewer accessToken');
  console.log('✓ Viewer login successful');

  // 4. Invalid login
  const badLoginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
  });
  assert(badLoginRes.status === 401, `Expected 401, got ${badLoginRes.status}`);
  const badLogin = await badLoginRes.json() as { error: { code: string } };
  assert(badLogin.error.code === 'UNAUTHORIZED', `Expected UNAUTHORIZED, got ${badLogin.error.code}`);
  console.log('✓ Invalid password properly rejected with 401 UNAUTHORIZED');

  // 5. Viewer Write Protection (403 FORBIDDEN on write)
  const viewerWriteRes = await fetch(`${SERVER_URL}/api/accounts/account_1/connect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${viewerAuth.accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  assert(viewerWriteRes.status === 403, `Expected 403 for viewer write, got ${viewerWriteRes.status}`);
  const viewerWrite = await viewerWriteRes.json() as { error: { code: string } };
  assert(viewerWrite.error.code === 'FORBIDDEN', `Expected FORBIDDEN, got ${viewerWrite.error.code}`);
  console.log('✓ Viewer write operations properly rejected with 403 FORBIDDEN');

  return { adminToken: adminAuth.accessToken, viewerToken: viewerAuth.accessToken };
}

async function testA1Accounts(adminToken: string) {
  console.log('\n--- [Testing SPEC A1: Accounts & State Machine CAS] ---');

  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // Reset gateway store for clean state
  await fetch(`${GATEWAY_URL}/mock/reset`, { method: 'POST' });

  // 1. Get Accounts
  const accListRes = await fetch(`${SERVER_URL}/api/accounts`, { headers });
  assert(accListRes.status === 200, `List accounts status: ${accListRes.status}`);
  const accounts = await accListRes.json() as Array<{ id: string; status: string }>;
  assert(accounts.length >= 4, 'Expected at least 4 seeded accounts');
  console.log(`✓ Fetched ${accounts.length} accounts from database`);

  // 2. Connect account_1
  const conn1Res = await fetch(`${SERVER_URL}/api/accounts/account_1/connect`, {
    method: 'POST',
    headers,
  });
  assert(conn1Res.status === 200, `Connect account_1 status: ${conn1Res.status}`);
  const conn1 = await conn1Res.json() as { status: string; platformUserId: string };
  assert(conn1.status === 'online', 'Expected status online');
  assert(conn1.platformUserId === 'u_account_1', 'Expected u_account_1');
  console.log('✓ Connected account_1 -> online (u_account_1)');

  // 3. Connect account_2 and account_3
  await fetch(`${SERVER_URL}/api/accounts/account_2/connect`, { method: 'POST', headers });
  await fetch(`${SERVER_URL}/api/accounts/account_3/connect`, { method: 'POST', headers });
  console.log('✓ Connected account_2 and account_3 -> online');

  // 4. Test Transition Table: online -> idle is valid
  const trans1Res = await fetch(`${SERVER_URL}/api/accounts/account_1/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedFrom: 'online', to: 'idle' }),
  });
  assert(trans1Res.status === 200, `Expected 200, got ${trans1Res.status}`);
  console.log('✓ Transitioned account_1: online -> idle');

  // 5. Test Illegal Transition: idle -> rate_limited is NOT allowed per A1 table
  const illegalTransRes = await fetch(`${SERVER_URL}/api/accounts/account_1/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedFrom: 'idle', to: 'rate_limited' }),
  });
  assert(illegalTransRes.status === 409, `Expected 409, got ${illegalTransRes.status}`);
  const illegalErr = await illegalTransRes.json() as { error: { code: string } };
  assert(illegalErr.error.code === 'ILLEGAL_TRANSITION', `Expected ILLEGAL_TRANSITION, got ${illegalErr.error.code}`);
  console.log('✓ Illegal transition correctly rejected with 409 ILLEGAL_TRANSITION');

  // 6. Test CAS Conflict: expectedFrom is 'online', but account is 'idle'
  const casConflictRes = await fetch(`${SERVER_URL}/api/accounts/account_1/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedFrom: 'online', to: 'disconnected' }),
  });
  assert(casConflictRes.status === 409, `Expected 409, got ${casConflictRes.status}`);
  const casErr = await casConflictRes.json() as { error: { code: string } };
  assert(casErr.error.code === 'CAS_CONFLICT', `Expected CAS_CONFLICT, got ${casErr.error.code}`);
  console.log('✓ CAS mismatch correctly rejected with 409 CAS_CONFLICT');

  // Re-connect account_1 to online for group testing
  await fetch(`${SERVER_URL}/api/accounts/account_1/connect`, { method: 'POST', headers });
  console.log('✓ Re-connected account_1 -> online');

  // 7. Test Terminal State on account_4
  const termRes = await fetch(`${SERVER_URL}/api/accounts/account_4/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedFrom: 'idle', to: 'suspended' }),
  });
  assert(termRes.status === 200, `Expected 200, got ${termRes.status}`);
  console.log('✓ account_4 transitioned to terminal state suspended');

  // Try to transition out of suspended -> should be rejected with ILLEGAL_TRANSITION
  const outTermRes = await fetch(`${SERVER_URL}/api/accounts/account_4/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedFrom: 'suspended', to: 'online' }),
  });
  assert(outTermRes.status === 409, `Expected 409, got ${outTermRes.status}`);
  console.log('✓ Outgoing transition from terminal state blocked');
}

async function testA3GroupsAndA2Messaging(adminToken: string) {
  console.log('\n--- [Testing SPEC A3: Group Creation & A2: Messaging] ---');

  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // 1. Validation test: creatorAccountId in memberAccountIds
  const valRes = await fetch(`${SERVER_URL}/api/groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ creatorAccountId: 'account_1', memberAccountIds: ['account_1', 'account_2'] }),
  });
  assert(valRes.status === 400, `Expected 400, got ${valRes.status}`);
  console.log('✓ Validation error caught (creator cannot be in members)');

  // 2. Validation test: member account not online (account_4 is suspended)
  const offlineMemRes = await fetch(`${SERVER_URL}/api/groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ creatorAccountId: 'account_1', memberAccountIds: ['account_4'] }),
  });
  assert(offlineMemRes.status === 422, `Expected 422 ACCOUNT_NOT_ONLINE, got ${offlineMemRes.status}`);
  console.log('✓ Account not online caught with 422 ACCOUNT_NOT_ONLINE');

  // 3. Valid Group Creation: account_1 (creator) + account_2 + account_3 -> 202 accepted
  const createRes = await fetch(`${SERVER_URL}/api/groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      creatorAccountId: 'account_1',
      memberAccountIds: ['account_2', 'account_3'],
    }),
  });
  assert(createRes.status === 202, `Expected 202 accepted, got ${createRes.status}`);
  const { jobId } = await createRes.json() as { jobId: string };
  assert(Boolean(jobId), 'Expected jobId in 202 response');
  console.log(`✓ Group creation job accepted: jobId=${jobId}`);

  // 4. Poll Job until finished
  let jobFinished = false;
  let finalJobData: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const jobRes = await fetch(`${SERVER_URL}/api/jobs/${jobId}`, { headers });
    assert(jobRes.status === 200, `Job query status: ${jobRes.status}`);
    const jobData = await jobRes.json() as { status: string; errors: any[]; result: any };
    if (jobData.status === 'finished') {
      jobFinished = true;
      finalJobData = jobData;
      break;
    }
    if (jobData.status === 'failed') {
      throw new Error(`Job ${jobId} failed: ${JSON.stringify(jobData.errors)}`);
    }
  }
  assert(jobFinished, 'Group creation job did not finish in time');
  const createdGroupId = finalJobData.result?.groupId;
  assert(Boolean(createdGroupId), 'Expected groupId in job result');
  console.log(`✓ Job completed: Group ID = ${createdGroupId}`);

  // 5. Inspect Group Details
  const groupRes = await fetch(`${SERVER_URL}/api/groups/${createdGroupId}`, { headers });
  assert(groupRes.status === 200, `Group query status: ${groupRes.status}`);
  const group = await groupRes.json() as {
    id: string;
    gatewayGroupId: string;
    members: Array<{ accountId: string; role: string }>;
  };
  assert(group.members.some((m) => m.accountId === 'account_1' && m.role === 'creator'), 'account_1 should be creator');
  assert(group.members.some((m) => m.accountId === 'account_2' && m.role === 'admin'), 'account_2 should be admin (promoted)');
  assert(group.members.some((m) => m.accountId === 'account_3' && m.role === 'member'), 'account_3 should be member');
  console.log('✓ Group roles verified: account_1 (creator), account_2 (admin), account_3 (member)');

  // 6. Send Message (SPEC A2)
  const sendRes = await fetch(`${SERVER_URL}/api/groups/${createdGroupId}/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: 'account_1', text: 'Hello Phase 2 Message Timeline' }),
  });
  assert(sendRes.status === 202, `Expected 202 accepted, got ${sendRes.status}`);
  const { clientMsgId } = await sendRes.json() as { clientMsgId: string };
  assert(Boolean(clientMsgId), 'Expected clientMsgId');
  console.log(`✓ Send message accepted with clientMsgId: ${clientMsgId}`);

  // 7. Verify Timeline Query
  // Wait 400ms for gateway delivery and SSE message_sent update
  await new Promise((r) => setTimeout(r, 400));
  const timelineRes = await fetch(`${SERVER_URL}/api/groups/${createdGroupId}/messages`, { headers });
  assert(timelineRes.status === 200, `Timeline status: ${timelineRes.status}`);
  const timeline = await timelineRes.json() as { items: Array<{ clientMsgId: string; deliveryStatus: string; text: string }> };
  const targetMsg = timeline.items.find((m) => m.clientMsgId === clientMsgId);
  assert(Boolean(targetMsg), 'Expected sent message to be in timeline');
  assert(targetMsg!.deliveryStatus === 'sent', `Expected deliveryStatus 'sent', got ${targetMsg!.deliveryStatus}`);
  console.log(`✓ Timeline verified: message status updated to 'sent' via SSE`);

  // 8. Test Sending with Non-member Account (should return 409 ACCOUNT_NOT_IN_GROUP)
  const nonMemberSendRes = await fetch(`${SERVER_URL}/api/groups/${createdGroupId}/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: 'account_4', text: 'Fail message' }),
  });
  assert(nonMemberSendRes.status === 409, `Expected 409, got ${nonMemberSendRes.status}`);
  console.log('✓ Non-member / unavailable account send blocked with 409');
}

async function main() {
  try {
    const { adminToken } = await testA0AuthAndHealth();
    await testA1Accounts(adminToken);
    await testA3GroupsAndA2Messaging(adminToken);

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE 2 (SPEC A0 ~ A3) VERIFICATIONS PASSED! 🎉');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Phase 2 Verification Failed:', err);
    process.exit(1);
  }
}

main();
