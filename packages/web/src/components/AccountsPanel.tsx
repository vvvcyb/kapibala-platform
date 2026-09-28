import React, { useState } from 'react';
import { Radio, RefreshCw, Power, PowerOff, ShieldAlert, Clock, UserCheck, AlertTriangle } from 'lucide-react';
import { Account, AccountStatus, api, AuthUser } from '../lib/api';

interface AccountsPanelProps {
  accounts: Account[];
  currentUser: AuthUser | null;
  onRefresh: () => void;
}

export const AccountsPanel: React.FC<AccountsPanelProps> = ({ accounts, currentUser, onRefresh }) => {
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const isViewer = currentUser?.role === 'viewer';

  const handleConnect = async (account: Account) => {
    if (isViewer) return;
    setLoadingMap((prev) => ({ ...prev, [account.id]: true }));
    setActionError(null);
    try {
      await api.connectAccount(account.id);
      onRefresh();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setActionError(`连接 ${account.id} 失败: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [account.id]: false }));
    }
  };

  const handleDisconnect = async (account: Account) => {
    if (isViewer) return;
    setLoadingMap((prev) => ({ ...prev, [account.id]: true }));
    setActionError(null);
    try {
      await api.transitionAccount(account.id, 'online', 'disconnected');
      onRefresh();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setActionError(`断开 ${account.id} 失败: ${e.message}`);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [account.id]: false }));
    }
  };

  const getStatusBadge = (status: AccountStatus) => {
    switch (status) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-glow-online"></span>
            在线 (Online)
          </span>
        );
      case 'idle':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            空闲 (Idle)
          </span>
        );
      case 'disconnected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-600/10 text-slate-500 border border-slate-600/20">
            <span className="w-2 h-2 rounded-full bg-slate-500"></span>
            已断开 (Disconnected)
          </span>
        );
      case 'rate_limited':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            限流中 (429)
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            已封禁 (Suspended)
          </span>
        );
      case 'session_expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            会话过期 (Expired)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800/80 p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              账号管理看板
              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 font-mono font-normal">
                4 个受管小号
              </span>
            </h2>
            <p className="text-xs text-slate-400">管理平台多小号状态机与网关 Session 绑定</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
          <span>刷新</span>
        </button>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Grid of Accounts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {accounts.map((acc) => {
          const isLoading = loadingMap[acc.id] || false;
          const isTerminal = acc.status === 'suspended' || acc.status === 'session_expired';
          const isOnline = acc.status === 'online';
          const canConnect = acc.status === 'idle' || acc.status === 'disconnected';

          return (
            <div
              key={acc.id}
              className={`p-4 rounded-xl border transition-all relative overflow-hidden flex flex-col justify-between ${
                isTerminal
                  ? 'bg-rose-950/20 border-rose-800/40'
                  : isOnline
                  ? 'bg-slate-900/90 border-emerald-500/30 shadow-sm shadow-emerald-500/5'
                  : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              {/* Account Card Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-white tracking-wide">
                    {acc.id}
                  </span>
                  {getStatusBadge(acc.status)}
                </div>

                {/* Platform User ID */}
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono text-slate-300">
                    {acc.platformUserId || <span className="text-slate-500 italic">未绑定</span>}
                  </span>
                </div>

                {/* Rate limit prompt */}
                {acc.status === 'rate_limited' && acc.rateLimitedUntil && (
                  <div className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>限流至: {new Date(acc.rateLimitedUntil).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons - HIDDEN FOR VIEWER */}
              <div className="mt-4 pt-3 border-t border-slate-800/60">
                {isViewer ? (
                  <div className="text-[11px] text-slate-500 italic text-center py-1 bg-slate-950/40 rounded-lg">
                    只读模式下不可操作账号
                  </div>
                ) : isTerminal ? (
                  <div className="flex items-center justify-center gap-1 text-xs text-rose-400 font-medium py-1">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>终态锁定 (无法转移)</span>
                  </div>
                ) : canConnect ? (
                  <button
                    type="button"
                    id={`btn-connect-${acc.id}`}
                    disabled={isLoading}
                    onClick={() => handleConnect(acc)}
                    className="w-full py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Power className="w-3.5 h-3.5 text-emerald-400" />
                        <span>连接账号</span>
                      </>
                    )}
                  </button>
                ) : isOnline ? (
                  <button
                    type="button"
                    id={`btn-disconnect-${acc.id}`}
                    disabled={isLoading}
                    onClick={() => handleDisconnect(acc)}
                    className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800/40 text-xs font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <PowerOff className="w-3.5 h-3.5 text-slate-400" />
                        <span>标记离线</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="text-[11px] text-slate-500 text-center py-1">
                    等待状态就绪...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
