# Kapibala 多账号群组消息平台

> 高可靠多账号群组消息管理平台，对接外部消息网关（HTTP + SSE）与智能 Agent 交互大脑（Anthropic tool_use 协议）。
> 全栈基于 TypeScript + React 18 + Node.js (Express + Prisma + WS) + Tailwind CSS 构建。

---

## 1. 🚀 快速启动指南 (One-Command Quickstart)

只需 3 步即可拉起完整系统的全部 4 项核心服务：

```bash
# 1. 启动本地 PostgreSQL 数据库容器
docker compose up -d

# 2. 安装 Monorepo 所有依赖并自动编译客户端
pnpm install

# 3. 一键并发启动 4 项核心评测服务 (Mock 网关 + Mock Agent + 核心后端 + Web 控制台)
pnpm dev:all
```

执行后将同时拉起：
- 🟦 **`gw` (Mock 消息网关)**：`http://localhost:4001`
- 🟨 **`agent` (Mock AI 决策大脑)**：`http://localhost:4002`
- 🟩 **`srv` (核心后端 & WebSocket 总线)**：`http://localhost:3000`
- 🟪 **`web` (React 18 管理控制台)**：`http://localhost:5173`

---

## 2. 🎯 核心功能与评审验收方式

本项目提供了完备的自动化机考检验脚本与交互式 Web 点测手段：

### 2.1 自动化机考测试套件 (Automated Verification)
在任意终端执行以下命令，即可自动化回归验证系统的全部核心业务契约：

```bash
# 阶段二验证：SPEC A0~A3 状态机 CAS、幂等建群 Job 引擎、消息时间线与 SSE 监听
pnpm verify:phase2

# 阶段三验证：SPEC A4 游标时间线分页 & WebSocket 实时总线 + SPEC A5 Agent 工具循环看门狗与内容安全审计
pnpm verify:phase3

# 基础 Mock 网关与 Agent 服务契约测试 (SPEC 2.1 & 2.2)
pnpm verify
```

### 2.2 Web 交互式控制台点测 (Interactive Evaluation)
在浏览器打开 **`http://localhost:5173`**：
1. **预置快捷登录**：
   - **管理员身份**：点击「以 admin 身份登录」，具备完整账号控制、建群与发信权限。
   - **只读观察员身份**：点击「以 viewer 身份登录」，所有写操作按钮自动隐匿，后端进行 403 权限隔离。
2. **账号状态与 CAS 乐观锁管理**：
   - 在「小号管理面板」实时查看 4 个服务账号的在线/限流/离线状态。
   - 支持「一键连接全部离线账号」或单个账号连接/下线，自动 CAS 乐观锁防并发覆盖。
3. **主流 IM 侧边栏与跨群未读红点**：
   - 左侧直观查看所有群组列表，支持「+ 一键异步建群向导」（分步进度条 20% -> 40% -> 60% -> 80% -> 100%）。
   - 当其他群收到新消息时，左侧侧边栏对应群卡片实时展示**高亮呼吸未读红点徽章**，切换该群自动清零。
4. **右下角「快速测试模拟器 (Quick Test Bar)」一键验证**：
   - 点击右下角闪电图标展开模拟面板：
   - **「模拟路人问好」**：一键注入非本方外部消息，观察左侧时间线上屏、右侧 Agent 决策步骤实时展开，以及小号身份回复。
   - **「模拟发违规广告」**：一键注入垃圾引流广告，观察安全审计判定、Agent 自动触发 `kick_user`，以及聊天区居中弹出的 **🛡️ AI 智能风控踢人通告**！
5. **SPEC 4.4 Agent 运行抽屉**：
   - 点击右侧决策卡片，可滑出抽屉查看每一轮思考、工具入参及内容安全审计判定。

### 2.3 真实 Telegram 机器人双向联动（可选彩蛋 / Bonus）
本项目提供了原生无重依赖的真实 Telegram 机器人双向长轮询桥接插件：
```bash
# 配置你的 Telegram Bot Token 并启动桥接器
export TELEGRAM_BOT_TOKEN="<your_telegram_bot_token>"
pnpm dev:tg
```
- **上行链路**：在手机 Telegram 群发送消息，桥接器实时注入本地系统，触发 Agent 决策与小号群内互动。
- **下行链路**：本地服务账号回复与违规踢人警报通告，毫秒级反向推送到 Telegram 手机群聊！

---

## 3. 系统架构与工程目录 (Monorepo)

本项目采用 `pnpm workspace` 构建清晰的多包架构：

```
.
├── packages/
│   ├── mock-gateway/    # 外部消息网关模拟服务 (端口 4001, SPEC 2.1)
│   ├── mock-agent/      # 外部 Agent 脑模拟服务 (端口 4002, SPEC 2.2)
│   ├── server/          # 核心业务后端 (Node.js + TS + Prisma + Express + WS, 端口 3000)
│   └── web/             # 操作控制台前端 (React 18 + TS + Vite + TailwindCSS, 端口 5173)
├── scripts/
│   ├── tg-bridge.ts     # Telegram 真实机器人长轮询双向桥接器
│   ├── verify-mocks.ts  # 阶段一验收脚本 (SPEC 2.1 & 2.2)
│   ├── verify-phase2.ts # 阶段二验收脚本 (SPEC A0 ~ A3)
│   └── verify-phase3.ts # 阶段三验收脚本 (SPEC A4 & A5)
├── docker-compose.yml   # PostgreSQL 16 数据库服务容器
├── pnpm-workspace.yaml  # pnpm workspace 定义
├── tsconfig.base.json   # 统一 TypeScript 基础配置
├── .env.example         # 环境变量配置模板
└── SPEC.md              # 完整需求规格说明书
```

---

## 4. 全局代码质量检查与构建

```bash
# 全 Monorepo 严格 TypeScript 类型检查 (0 errors)
pnpm typecheck

# 全包生产构建验证
pnpm build
```
