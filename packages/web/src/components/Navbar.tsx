import React from 'react';
import { ShieldCheck, Eye, LogOut, Radio, Beaker, Lock } from 'lucide-react';
import { AuthUser } from '../lib/api';

interface NavbarProps {
  user: AuthUser | null;
  wsConnected: boolean;
  onLogout: () => void;
  showQuickTest: boolean;
  onToggleQuickTest: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  wsConnected,
  onLogout,
  showQuickTest,
  onToggleQuickTest,
}) => {
  const isViewer = user?.role === 'viewer';

  return (
    <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-40">
      {/* Brand & Left Info */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
          K
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-base tracking-tight text-white">Kapibala Platform</h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              SPEC A6
            </span>
          </div>
          <p className="text-xs text-slate-400 hidden sm:block">多账号协同运营与 Agent 决策监控控制台</p>
        </div>
      </div>

      {/* Prominent Read-Only Mode Banner for Viewer */}
      {isViewer && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold shadow-sm animate-pulse">
          <Eye className="w-4 h-4 text-amber-400" />
          <span>只读观察者模式 — 所有写操作已隔离禁用 (Read-Only)</span>
          <Lock className="w-3.5 h-3.5 text-amber-400" />
        </div>
      )}

      {/* Right Controls */}
      <div className="flex items-center gap-3 ml-auto">
        {/* WS Status */}
        <div
          title={wsConnected ? 'WebSocket 实时链路正常' : 'WebSocket 正在尝试连接...'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            wsConnected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${wsConnected ? 'animate-pulse text-emerald-400' : 'text-rose-400'}`} />
          <span className="hidden md:inline">{wsConnected ? 'WS 实时在线' : 'WS 离线'}</span>
        </div>

        {/* Quick Test Bar Toggle */}
        <button
          type="button"
          onClick={onToggleQuickTest}
          id="btn-toggle-quicktest"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
            showQuickTest
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-500/30'
              : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
          }`}
        >
          <Beaker className="w-3.5 h-3.5 text-indigo-400" />
          <span>快捷模拟器</span>
        </button>

        {/* User Info & Role */}
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
              {isViewer ? (
                <div className="flex items-center gap-1 text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg border border-amber-400/20">
                  <Eye className="w-3.5 h-3.5" />
                  <span>{user.username} (观察者)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-lg border border-emerald-400/20">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{user.username} (管理员)</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onLogout}
              title="退出登录"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
