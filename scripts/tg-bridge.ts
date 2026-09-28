import fs from 'fs';
import path from 'path';

// Bot Configuration
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '8477597666:AAF_VcokEyzDWUgsbHvEDDd-k_-KrqkDVOs';
const TG_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const LOCAL_SERVER_BASE = process.env.LOCAL_SERVER_BASE || 'http://localhost:3000';
const LOCAL_GATEWAY_BASE = process.env.LOCAL_GATEWAY_BASE || 'http://localhost:4001';

const CHAT_ID_CACHE_FILE = path.resolve(process.cwd(), '.last_tg_chat_id');

let currentChatId: string | number | null = null;
let currentChatTitle: string = '未绑定';
let cachedAdminToken: string | null = null;
let cachedGatewayGroupId: string | null = null;
let isStopping = false;

// Load cached chat ID if available
if (fs.existsSync(CHAT_ID_CACHE_FILE)) {
  try {
    const raw = fs.readFileSync(CHAT_ID_CACHE_FILE, 'utf-8').trim();
    if (raw) {
      currentChatId = raw;
      console.log(`📌 已从本地缓存恢复上次绑定的 Telegram Chat ID: ${currentChatId}`);
    }
  } catch {}
}

function saveChatId(chatId: string | number, title?: string): void {
  currentChatId = chatId;
  if (title) currentChatTitle = title;
  try {
    fs.writeFileSync(CHAT_ID_CACHE_FILE, String(chatId), 'utf-8');
  } catch {}
}

// 1. Fetch Bot Info (getMe)
async function verifyTelegramBot(): Promise<{ id: number; username: string; firstName: string }> {
  const res = await fetch(`${TG_API_BASE}/getMe`);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram getMe 失败 (${res.status}): ${errText}`);
  }
  const data: any = await res.json();
  if (!data.ok || !data.result) {
    throw new Error(`Telegram getMe 返回异常: ${JSON.stringify(data)}`);
  }
  return {
    id: data.result.id,
    username: data.result.username || '',
    firstName: data.result.first_name || '',
  };
}

// 2. Obtain local admin token for querying groups
async function getLocalAdminToken(): Promise<string> {
  if (cachedAdminToken) return cachedAdminToken;
  try {
    const res = await fetch(`${LOCAL_SERVER_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    if (!res.ok) {
      throw new Error(`登录后端失败 (${res.status})`);
    }
    const data: any = await res.json();
    cachedAdminToken = data.accessToken;
    return cachedAdminToken!;
  } catch (err: any) {
    console.warn(`[本地平台认证] 无法自动登录后端: ${err.message}，将在使用时重试`);
    throw err;
  }
}

// 3. Obtain active local group with gatewayGroupId
async function getActiveGatewayGroupId(): Promise<string> {
  if (cachedGatewayGroupId) return cachedGatewayGroupId;
  try {
    const token = await getLocalAdminToken();
    const res = await fetch(`${LOCAL_SERVER_BASE}/api/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`获取群组列表失败 (${res.status})`);
    }
    const groups: any[] = await res.json();
    const activeGroup = groups.find((g) => g.status === 'active' && g.gatewayGroupId) || groups[0];
    if (activeGroup && activeGroup.gatewayGroupId) {
      cachedGatewayGroupId = activeGroup.gatewayGroupId;

      // Automatically enable Agent and AutoKick if disabled
      if (!activeGroup.agentEnabled || !activeGroup.autoKickEnabled) {
        await fetch(`${LOCAL_SERVER_BASE}/api/groups/${activeGroup.id}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ agentEnabled: true, autoKickEnabled: true }),
        }).catch(() => {});
        console.log(`⚙️ 已确保本地群聊 ${activeGroup.id} 开启了智能助手 (Agent) 与自动踢人机制`);
      }

      return cachedGatewayGroupId!;
    }
  } catch (err: any) {
    console.warn(`[本地群组检测] 未能获取群组列表 (${err.message})，使用默认群组 g_1`);
  }
  return 'g_1';
}

// 4. Send Message to Telegram Chat
async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${TG_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const data: any = await res.json();
    if (!data.ok) {
      // Retry without parse_mode in case of HTML tag conflicts
      const plainRes = await fetch(`${TG_API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      });
      const plainData: any = await plainRes.json();
      return plainData.ok;
    }
    return true;
  } catch (err: any) {
    console.error(`[Telegram API 错误] 发送消息至 TG 失败:`, err.message);
    return false;
  }
}

// 5. Inbound: Telegram Long Polling (Telegram -> Local Platform)
async function startTelegramPoller(botId: number): Promise<void> {
  let offset = 0;
  console.log(`📡 [TG 上行] 长轮询监听中... 在 Telegram 群聊中发送消息即可直连本地系统`);

  while (!isStopping) {
    try {
      const url = `${TG_API_BASE}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`;
      const res = await fetch(url);
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data: any = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = Math.max(offset, update.update_id + 1);

          const msg = update.message;
          if (!msg || !msg.text) continue;

          // Ignore messages from the bot itself
          if (msg.from?.is_bot || msg.from?.id === botId) {
            continue;
          }

          // Record active chat ID
          const chatId = msg.chat.id;
          const chatTitle = msg.chat.title || msg.chat.username || `私聊 (${msg.from?.first_name || 'User'})`;
          if (currentChatId !== chatId) {
            saveChatId(chatId, chatTitle);
            console.log(`🎯 [TG 目标群绑定] 成功绑定 Telegram 会话: "${chatTitle}" (Chat ID: ${chatId})`);
          }

          const senderName = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || `用户${msg.from?.id}`);
          const senderPlatformUserId = `tg_${msg.from?.username || msg.from?.id || 'visitor'}`;
          const text = msg.text.trim();

          console.log(`\n📨 [TG -> 本地平台] ${senderName} (${senderPlatformUserId}): "${text}"`);

          // Deliver message into local Mock Gateway
          try {
            const gatewayGroupId = await getActiveGatewayGroupId();
            const injectRes = await fetch(`${LOCAL_GATEWAY_BASE}/mock/groups/${gatewayGroupId}/inbound-message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                senderPlatformUserId,
                text,
              }),
            });

            if (injectRes.ok) {
              console.log(`   ↳ ✅ 已注入 Mock 网关 (群: ${gatewayGroupId}) -> 触发前端时间线上屏与 Agent 决策`);
            } else {
              console.warn(`   ↳ ⚠️ 注入 Mock 网关返回 HTTP ${injectRes.status}`);
            }
          } catch (err: any) {
            console.error(`   ↳ ❌ 转发至 Mock 网关异常:`, err.message);
          }
        }
      }
    } catch (err: any) {
      if (!isStopping) {
        console.warn(`[TG 轮询网络波动] ${err?.message || err}，将在 3 秒后重试...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

// 6. Outbound: Listen to Gateway SSE (Local Platform -> Telegram)
async function startGatewaySSEListener(): Promise<void> {
  let since: number | null = null;
  console.log(`👂 [TG 下行] 正在连接 Mock 网关 SSE 流 (${LOCAL_GATEWAY_BASE}/events)...`);

  while (!isStopping) {
    try {
      const url = since !== null
        ? `${LOCAL_GATEWAY_BASE}/events?since=${since}`
        : `${LOCAL_GATEWAY_BASE}/events`;
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      console.log(`🔗 [TG 下行] Mock 网关 SSE 链路建立成功，实时监听小号与 Agent 响应`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!isStopping) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const lines = block.split('\n');
          let eventType = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('id: ')) {
              const idNum = parseInt(line.slice(4).trim(), 10);
              if (!isNaN(idNum)) since = idNum;
            } else if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr += line.slice(6);
            }
          }

          if (dataStr) {
            try {
              const eventPayload = JSON.parse(dataStr);
              await handleLocalEvent(eventType, eventPayload);
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (!isStopping) {
        console.warn(`[网关 SSE 断线] ${err?.message || err}，将在 2 秒后自动重连...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}

// 7. Handle Local Events from Gateway
async function handleLocalEvent(eventType: string, payload: any): Promise<void> {
  // A. Message Event (Sent by our account or agent)
  if (eventType === 'message' || payload.type === 'message') {
    const sender = String(payload.senderPlatformUserId || '');
    const isOwn = sender.startsWith('u_account_') || sender.includes('account_') || payload.isOwn === true;

    // Only forward messages from our service accounts / Agent (exclude echo of external messages)
    if (isOwn) {
      const accountId = sender.replace(/^u_/, '');
      const text = payload.text || '';

      console.log(`\n📤 [本地平台 -> TG 回复] 小号 ${accountId} 发出回复: "${text}"`);

      if (currentChatId) {
        const tgText = `🤖 <b>[${accountId}]</b>: ${text}`;
        const sent = await sendTelegramMessage(currentChatId, tgText);
        if (sent) {
          console.log(`   ↳ ✅ 已成功推送到 Telegram 群聊 (Chat: ${currentChatId})`);
        }
      } else {
        console.log(`   ↳ ℹ️ 当前尚未绑定 TG 会话，暂存消息 (请在手机 TG 群内发送任意消息以激活绑定)`);
      }
    }
  }

  // B. Member Left Event (Spammer auto-kicked by AI Agent)
  else if (eventType === 'member_left' || payload.type === 'member_left') {
    const platformUserId = String(payload.platformUserId || '');
    const isSpammer = platformUserId.toLowerCase().includes('spammer') || payload.reason?.includes('violation');

    if (isSpammer) {
      console.log(`\n🚨 [本地平台 -> TG 风控] 检测到 Agent 执行踢人: ${platformUserId}`);
      if (currentChatId) {
        const alertText = `🚨 <b>[AI 智能风控通告]</b>\n检测到垃圾广告违规引流，已自动将违规成员 <code>${platformUserId}</code> 移出群聊！`;
        await sendTelegramMessage(currentChatId, alertText);
        console.log(`   ↳ ✅ 安全踢人通告已同步至 Telegram 群聊！`);
      }
    }
  }
}

// Main Process
async function main() {
  console.log('========================================================');
  console.log('🚀 启动 Kapibala - Telegram 双向机器人桥接插件');
  console.log('========================================================');

  try {
    const bot = await verifyTelegramBot();
    console.log(`✅ 成功连接 Telegram Bot API:`);
    console.log(`   - 机器人 ID: ${bot.id}`);
    console.log(`   - 机器人名称: ${bot.firstName}`);
    console.log(`   - 机器人用户名: @${bot.username}`);
    console.log(`   - 当前绑定会话: ${currentChatId ? `${currentChatTitle} (${currentChatId})` : '未绑定 (请在群内发言一次)'}`);
    console.log('--------------------------------------------------------');

    // Query active local group
    const gatewayGroupId = await getActiveGatewayGroupId();
    console.log(`🎯 目标本地 Mock 群组: ${gatewayGroupId}`);
    console.log('--------------------------------------------------------');

    // Start SSE listener and Telegram Poller concurrently
    await Promise.all([
      startGatewaySSEListener(),
      startTelegramPoller(bot.id),
    ]);
  } catch (err: any) {
    console.error('❌ 启动 Telegram 桥接器失败:', err.message);
    process.exit(1);
  }
}

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 正在停止 Telegram 桥接插件...');
  isStopping = true;
  process.exit(0);
});

process.on('SIGTERM', () => {
  isStopping = true;
  process.exit(0);
});

main();
