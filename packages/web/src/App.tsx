import { useState } from 'react';
import { Activity, Shield, Users, MessageSquare, Terminal } from 'lucide-react';

export function App() {
  const [gatewayStatus] = useState<string>('Ready (Port 4001)');
  const [agentStatus] = useState<string>('Ready (Port 4002)');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            K
          </div>
          <div>
            <h1 className="font-semibold text-lg tracking-tight">Kapibala Platform</h1>
            <p className="text-xs text-slate-400">多账号群组消息平台控制台</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            第一阶段：工程骨架 &amp; Mock 服务就绪
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Service Health Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Mock Gateway</span>
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="mt-4">
              <div className="text-xl font-bold">{gatewayStatus}</div>
              <p className="text-xs text-slate-400 mt-1">HTTP + SSE 事件总线 (2.1 规范)</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Mock Agent</span>
              <Terminal className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="mt-4">
              <div className="text-xl font-bold">{agentStatus}</div>
              <p className="text-xs text-slate-400 mt-1">Anthropic tool_use &amp; 审计 (2.2 规范)</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Core Backend</span>
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <div className="mt-4">
              <div className="text-xl font-bold">Node + TS + Prisma</div>
              <p className="text-xs text-slate-400 mt-1">数据模型与业务核心 (第二阶段)</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Web Console</span>
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div className="mt-4">
              <div className="text-xl font-bold">React 18 + Vite</div>
              <p className="text-xs text-slate-400 mt-1">管理面板与时间线 (第二阶段)</p>
            </div>
          </div>
        </div>

        {/* Phase 1 Overview Panel */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
            <MessageSquare className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-base">系统架构与第一阶段成果</h2>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            本项目基于 pnpm workspace 构建。已在 <code className="text-indigo-300">packages/mock-gateway</code> (端口 4001) 与{' '}
            <code className="text-indigo-300">packages/mock-agent</code> (端口 4002) 中完整落地 SPEC 2.1 与 2.2 的协议与时序，
            支持单调递增 SSE 事件流、入群延迟推送、发消息 202 异步落地、429/504 异常模拟，以及 Anthropic tool_use 多轮问答与自动违规踢人。
          </p>
        </div>
      </main>
    </div>
  );
}
export default App;
