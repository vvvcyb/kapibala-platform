import React, { useState } from 'react';
import { ShieldCheck, Eye, LogIn, KeyRound, User, AlertCircle } from 'lucide-react';
import { api, setToken } from '../lib/api';

interface LoginModalProps {
  onLoginSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (user: string, pass: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(user, pass);
      setToken(res.accessToken);
      onLoginSuccess();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || '登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    handleLogin(username.trim(), password.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-emerald-400 flex items-center justify-center font-bold text-white text-xl shadow-lg shadow-indigo-500/25">
            K
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Kapibala 平台登录</h2>
          <p className="text-xs text-slate-400">多账号群组消息运营与智能助理控制台</p>
        </div>

        {/* Quick Logins */}
        <div className="space-y-2.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
            预置快捷身份登录 (一键进入)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              id="quick-login-admin"
              disabled={loading}
              onClick={() => handleLogin('admin', 'admin')}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-medium text-xs sm:text-sm transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>管理员 (admin)</span>
            </button>
            <button
              type="button"
              id="quick-login-viewer"
              disabled={loading}
              onClick={() => handleLogin('viewer', 'viewer')}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-medium text-xs sm:text-sm transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <Eye className="w-4 h-4 text-amber-400" />
              <span>观察者 (viewer)</span>
            </button>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-800 w-full"></div>
          <span className="bg-slate-900 px-3 text-xs text-slate-500 uppercase tracking-widest absolute">
            或输入密码
          </span>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              用户名
            </label>
            <input
              type="text"
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin / viewer"
              disabled={loading}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              密码
            </label>
            <input
              type="password"
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              disabled={loading}
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            id="login-submit-btn"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-medium text-sm transition-all shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>登录系统</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
