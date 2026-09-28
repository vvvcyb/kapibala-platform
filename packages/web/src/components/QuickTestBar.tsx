import React, { useState } from 'react';
import { Beaker, MessageCircle, AlertTriangle, CheckCircle, Sparkles, X } from 'lucide-react';
import { api, Group } from '../lib/api';

interface QuickTestBarProps {
  currentGroup: Group | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export const QuickTestBar: React.FC<QuickTestBarProps> = ({
  currentGroup,
  isOpen,
  onClose,
  onRefresh,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const handleSimulateGreeting = async () => {
    if (!currentGroup || !currentGroup.gatewayGroupId) {
      showToast('error', '请先选择一个包含有效网关群聊的群组');
      return;
    }

    setLoadingAction('greeting');
    try {
      if (!currentGroup.agentEnabled) {
        await api.updateGroupSettings(currentGroup.id, { agentEnabled: true, autoKickEnabled: true });
        currentGroup.agentEnabled = true;
      }

      await api.simulateInboundMessage(
        currentGroup.gatewayGroupId,
        'u_visitor_88',
        '大家好！请问这个群是 Kapibala 智能客服服务群吗？'
      );
      showToast('success', '已成功注入外部访客消息！请观察右侧 Agent 思考与自动应答');
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { message?: string };
      showToast('error', `模拟失败: ${e.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSimulateViolation = async () => {
    if (!currentGroup || !currentGroup.gatewayGroupId) {
      showToast('error', '请先选择一个包含有效网关群聊的群组');
      return;
    }

    setLoadingAction('violation');
    try {
      if (!currentGroup.agentEnabled || !currentGroup.autoKickEnabled) {
        await api.updateGroupSettings(currentGroup.id, { agentEnabled: true, autoKickEnabled: true });
        currentGroup.agentEnabled = true;
        currentGroup.autoKickEnabled = true;
      }

      const spammerId = `u_spammer_${Math.floor(Math.random() * 900 + 100)}`;
      // 1. Add member to gateway
      await api.simulateAddMember(currentGroup.gatewayGroupId, spammerId);
      // 2. Send spam violation text
      await api.simulateInboundMessage(
        currentGroup.gatewayGroupId,
        spammerId,
        '【高薪兼职】日结800-1500元，居家操作无门槛，添加微信领取彩金！'
      );
      showToast('success', `已注入违规者 ${spammerId} 及广告！请观察 Agent 触发审计与自动踢人`);
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { message?: string };
      showToast('error', `模拟违规失败: ${e.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 w-96 rounded-2xl bg-slate-900/95 border border-indigo-500/40 shadow-2xl backdrop-blur-md p-4 space-y-3 animate-in slide-in-from-bottom duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
            <Beaker className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              快速测试模拟器 (Simulator)
              <Sparkles className="w-3 h-3 text-amber-400" />
            </h4>
            <p className="text-[10px] text-slate-400">
              目标网关群: {currentGroup?.gatewayGroupId || '未选择有效群组'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {toast && (
        <div
          className={`p-2.5 rounded-xl text-xs flex items-center gap-2 transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          )}
          <span className="text-[11px] leading-tight">{toast.message}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          id="btn-simulate-greeting"
          disabled={loadingAction !== null || !currentGroup}
          onClick={handleSimulateGreeting}
          className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-200 text-xs font-medium transition-all group disabled:opacity-40"
        >
          <div className="flex items-center gap-2 text-left">
            <MessageCircle className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
            <div>
              <div className="font-semibold text-white text-xs">模拟路人进群问好</div>
              <div className="text-[10px] text-slate-400">注入正常询问，观察 Agent 自动应答</div>
            </div>
          </div>
          {loadingAction === 'greeting' ? (
            <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              问好
            </span>
          )}
        </button>

        <button
          type="button"
          id="btn-simulate-violation"
          disabled={loadingAction !== null || !currentGroup}
          onClick={handleSimulateViolation}
          className="flex items-center justify-between p-2.5 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-200 text-xs font-medium transition-all group disabled:opacity-40"
        >
          <div className="flex items-center gap-2 text-left">
            <AlertTriangle className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform" />
            <div>
              <div className="font-semibold text-rose-100 text-xs">模拟发违规广告</div>
              <div className="text-[10px] text-slate-400">注入刷单/黑产广告，触发审计自动踢人</div>
            </div>
          </div>
          {loadingAction === 'violation' ? (
            <div className="w-3.5 h-3.5 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
              违规踢人
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
