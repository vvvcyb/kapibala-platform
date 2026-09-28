# Kapibala 多账号群组消息平台

> 高可靠多账号群组消息管理平台，对接外部消息网关（HTTP + SSE）与智能 Agent 交互大脑（Anthropic tool_use 协议）。

---

## 1. 系统架构与工程目录 (Monorepo)

本项目采用 `pnpm workspace` 构建清晰的多包架构：

```
.
├── packages/
│   ├── mock-gateway/    # [已就绪] 外部消息网关模拟服务 (端口 4001, SPEC 2.1)
│   ├── mock-agent/      # [已就绪] 外部 Agent 脑模拟服务 (端口 4002, SPEC 2.2)
│   ├── server/          # [骨架就绪] 核心业务后端 (Node.js + TS + Prisma + Express)
│   └── web/             # [骨架就绪] 管理控制台前端 (React 18 + TS + Vite + TailwindCSS)
├── scripts/
│   └── verify-mocks.ts  # 第一阶段自动化验收测试脚本
├── docker-compose.yml   # PostgreSQL 16 数据库与预留服务配置
├── pnpm-workspace.yaml  # pnpm workspace 定义
├── tsconfig.base.json   # 统一 TypeScript 基础配置
├── .env.example         # 环境变量配置模板
└── SPEC.md              # 完整需求规格说明书
```

---

## 2. 外部 Mock 服务规范落地说明

### 2.1 消息网关 (`packages/mock-gateway`, 默认端口 `4001`)
严格遵循 `SPEC.md` 第 2.1 节约定：
- **账号端点**：
  - 内存预置 `account_1`, `account_2`, `account_3`, `account_4`，初始状态 `idle`。
  - `POST /accounts/:accountId/connect`：返回 `{ platformUserId: "u_" + accountId }`，状态切为 `online`。
  - `POST /accounts/:accountId/disconnect`：账号离线，后续操作返回 `409 ACCOUNT_OFFLINE`。
  - 终态联动：通过 `/mock/accounts/:accountId/status` 将账号标记为 `suspended` 或 `session_expired` 时，自动推送 `account_status` 事件，并自动将其从所有群中移出且触发 `member_left` 事件。
- **群组与成员端点**：
  - `POST /groups { creatorAccountId }`：创建群，创建者直接为成员（不触发 `member_joined`）。
  - `POST /groups/:groupId/invite`：生成邀请链接，支持 `readyAfterMs`（未准备好前返回 `409 INVITE_NOT_READY`，过期返回 `410 INVITE_EXPIRED`）。
  - `POST /groups/:groupId/join { accountId, inviteLink }`：返回 `202 { accepted: true }`，延迟 300ms 后触发 `member_joined` SSE 事件。重复入群返回 `409 ALREADY_MEMBER`。
  - `POST /groups/:groupId/promote { byAccountId, accountId }`：群主提升管理员，返回 `200`（不推事件）。
  - `POST /groups/:groupId/kick { byAccountId, targetPlatformUserId }`：在 200 返回前将目标移出群成员，随后推送 `member_left`。
  - `POST /groups/:groupId/leave { accountId }`：账号退群，触发 `member_left`。
  - `GET /groups/:groupId/members`：返回当前群内网关视角的成员列表 `[{ platformUserId }]`。
- **发消息与状态查询**：
  - `POST /groups/:groupId/send { accountId, clientMsgId, text }`：立即返回 `202 { accepted: true }`；延迟 200ms 后推 `message_sent` 与 `message` 事件。
  - `GET /groups/:groupId/messages/by-client-id/:clientMsgId`：根据 `clientMsgId` 查询落地状态（`200 { msgId, sentAt }` / `404`）。
  - 支持故障与场景模拟：支持 `429 RATE_LIMITED`（带 `retryAfterSeconds` 计时重置）、`504 NETWORK_TIMEOUT`（支持 S5 异步落网模拟）、`503 SERVICE_UNAVAILABLE`、`GROUP_WRITE_FORBIDDEN` 等。
- **SSE 事件流 (`GET /events?since=<eventId>`)**：
  - 全局单调递增 `eventId`，历史全量保存在内存缓冲区。
  - 支持断线重连：带 `since` 查询参数独占回溯补发。
  - 支持 S2 场景事件重复推送配置 (`/mock/config { duplicateEvents: true }`)。

### 2.2 Agent 服务 (`packages/mock-agent`, 默认端口 `4002`)
严格遵循 `SPEC.md` 第 2.2 节约定：
- **`POST /agent/turn`**：
  - 遵循 Anthropic Messages API 的 tool use 协议结构（`runId`, `tools`, `messages`）。
  - 严格校验 4 个必选工具：`get_recent_messages`, `send_message`, `kick_user`, `finish`，入参 schema 缺失将返回 `400 TOOLS_INVALID`。
  - **内置智能决策模拟**：
    - 常规消息/问候：首轮调用 `send_message` 工具回复，收到 `tool_result` 结果后下一轮调用 `finish` 工具完成运行。
    - 违规与广告消息（如文本命中 `spam`, `广告`, `违规`, `kick` 等关键词）：首轮调用 `kick_user` 工具踢掉违规发送者，下一轮调用 `finish`。
  - 支持异常与鲁棒性模拟（可配置 header）：`x-mock-bad-json`（测试代码围栏/坏 JSON）、`x-mock-unknown-tool`（测试未知工具）、`x-mock-duplicate-tool-id`、`x-mock-delay` 等。
- **`POST /agent/audit { text, groupId }`**：
  - 默认返回 `200 { verdict: "pass", reason: "content safe" }`。
  - 若文本包含 `reject` 或 `违规`，返回 `200 { verdict: "fail", reason: "audit policy violation: detected prohibited keyword" }`。

---

## 3. 快速启动与验证指南

### 3.1 环境要求
- Node.js >= 18 (推荐 v20 或 v22/v24)
- pnpm >= 9

### 3.2 安装依赖
```bash
pnpm install
```

### 3.3 启动外部 Mock 服务

**方式一：分别启动（独立控制台）**
```bash
# 启动消息网关 (端口 4001)
pnpm --filter mock-gateway dev

# 启动 Agent 服务 (端口 4002)
pnpm --filter mock-agent dev
```

**方式二：根目录便捷命令**
```bash
pnpm dev:gateway
pnpm dev:agent
```

### 3.4 执行各阶段全量验收测试
- **阶段一验收（Mock 网关与 Agent 契约）**：
  ```bash
  pnpm verify
  ```
- **阶段二验收（核心后端 A0~A3、状态机 CAS、建群与消息时间线）**：
  ```bash
  pnpm verify:phase2
  ```
- **阶段三验收（A4 游标分页 & WebSocket 实时总线 + A5 Agent 循环引擎与看门狗）**：
  ```bash
  pnpm verify:phase3
  ```

### 3.5 全局类型检查与构建
```bash
# 全包严格 TypeScript 检查
pnpm typecheck

# 全包生产构建验证
pnpm build
```

### 3.6 数据库管理 (PostgreSQL)
```bash
# 启动 PostgreSQL 容器
docker compose up postgres -d

# 执行数据库迁移与种子数据填充
pnpm --filter server run prisma:generate
pnpm --filter server run prisma:seed
```
