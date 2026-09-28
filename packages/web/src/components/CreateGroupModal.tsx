import React, { useState, useEffect } from 'react';
import { X, Users, CheckCircle2, AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react';
import { Account, api } from '../lib/api';

interface CreateGroupModalProps {
  accounts: Account[];
  onClose: () => void;
  onGroupCreated: (newGroupId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  accounts,
  onClose,
  onGroupCreated,
}) => {
  const onlineAccounts = accounts.filter((a) => a.status === 'online');
  const [creatorId, setCreatorId] = useState<string>(onlineAccounts[0]?.id || accounts[0]?.id || '');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<string>('等待提交任务...');
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'finished' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize selected members excluding creator
  useEffect(() => {
    if (!creatorId && accounts.length > 0) {
      setCreatorId(accounts[0].id);
    }
  }, [accounts, creatorId]);

  const toggleMember = (accId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(accId) ? prev.filter((id) => id !== accId) : [...prev, accId]
    );
  };

  // Poll Job Status when jobId is set
  useEffect(() => {
    if (!jobId || jobStatus === 'finished' || jobStatus === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const job = await api.getJob(jobId);
        if (job.progress !== undefined) {
          setProgress(job.progress);
        }
        if (job.step) {
          setCurrentStep(job.step);
        }

        if (job.status === 'finished') {
          setJobStatus('finished');
          setProgress(100);
          setCurrentStep('建群任务已圆满完成！');
          clearInterval(interval);
          setTimeout(() => {
            if (job.result?.groupId) {
              onGroupCreated(job.result.groupId);
            }
            onClose();
          }, 1200);
        } else if (job.status === 'failed') {
          setJobStatus('failed');
          const errDetail = job.errors?.length
            ? job.errors.map((e) => `${e.step}: ${e.code}`).join(', ')
            : '建群失败，请稍后重试';
          setErrorMessage(errDetail);
          clearInterval(interval);
        }
      } catch (err: unknown) {
        console.error('Failed to poll job status:', err);
      }
    }, 600);

    return () => clearInterval(interval);
  }, [jobId, jobStatus, onGroupCreated, onClose]);

  const handleStartCreate = async () => {
    if (!creatorId) {
      setErrorMessage('请选择一个创建者账号');
      return;
    }
    if (selectedMembers.length === 0) {
      setErrorMessage('请至少选择一个被邀请成员账号');
      return;
    }

    setIsSubmitting(true);
    setJobStatus('running');
    setProgress(20);
    setCurrentStep('初始化创建群聊请求...');
    setErrorMessage(null);

    try {
      const res = await api.createGroup(creatorId, selectedMembers);
      setJobId(res.jobId);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setJobStatus('failed');
      setErrorMessage(e.message || '建群任务提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">一键异步建群向导 (SPEC A3)</h3>
              <p className="text-xs text-slate-400">选择群主与协作成员，系统将自动入群与提管</p>
            </div>
          </div>
          {jobStatus !== 'running' && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Job In Progress or Finished */}
          {jobStatus === 'running' || jobStatus === 'finished' ? (
            <div className="space-y-5 py-4 text-center">
              <div className="flex justify-center">
                {jobStatus === 'finished' ? (
                  <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                    <div className="w-7 h-7 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-base font-bold text-white">
                  {jobStatus === 'finished' ? '群组创建成功！' : '正在执行异步建群作业...'}
                </h4>
                <p className="text-xs font-mono text-indigo-300 mt-1">步骤: {currentStep}</p>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>进度</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/50">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Step Flow Indicators */}
              <div className="grid grid-cols-4 gap-2 pt-2 text-[11px] text-slate-400 font-mono">
                <div className={`p-2 rounded-lg border ${progress >= 20 ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950/40 border-slate-800'}`}>
                  1. 网关建群
                </div>
                <div className={`p-2 rounded-lg border ${progress >= 40 ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950/40 border-slate-800'}`}>
                  2. 生成邀请
                </div>
                <div className={`p-2 rounded-lg border ${progress >= 60 ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950/40 border-slate-800'}`}>
                  3. SSE入群
                </div>
                <div className={`p-2 rounded-lg border ${progress >= 80 ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950/40 border-slate-800'}`}>
                  4. 晋升管理
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Creator Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>选择群主账号 (Creator)</span>
                  <span className="text-[11px] font-normal text-slate-500">必须在线</span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {accounts.map((acc) => {
                    const isSelected = creatorId === acc.id;
                    const isOnline = acc.status === 'online';
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setCreatorId(acc.id);
                          setSelectedMembers((prev) => prev.filter((id) => id !== acc.id));
                        }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                            : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
                        } ${!isOnline ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-semibold">{acc.id}</span>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                            }`}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">
                          {acc.platformUserId || '未绑定'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Members Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>邀请入群小号成员 (Members)</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    首个成员将自动提升为管理员
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {accounts
                    .filter((acc) => acc.id !== creatorId)
                    .map((acc, idx) => {
                      const isChecked = selectedMembers.includes(acc.id);
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => toggleMember(acc.id)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isChecked
                              ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm'
                              : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-sm font-medium">{acc.id}</span>
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                                isChecked
                                  ? 'bg-purple-600 border-purple-500 text-white'
                                  : 'border-slate-700'
                              }`}
                            >
                              {isChecked && '✓'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
                            {idx === 0 && isChecked && (
                              <span className="flex items-center gap-0.5 text-amber-400">
                                <ShieldCheck className="w-3 h-3" />
                                设为管理员
                              </span>
                            )}
                            {(!isChecked || idx !== 0) && (
                              <span className="font-mono">{acc.platformUserId || '小号'}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {jobStatus !== 'running' && jobStatus !== 'finished' && (
          <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              id="btn-submit-create-group"
              disabled={isSubmitting || selectedMembers.length === 0}
              onClick={handleStartCreate}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-medium transition-all shadow-md shadow-indigo-500/20 flex items-center gap-1.5 disabled:opacity-50"
            >
              <span>启动异步建群</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
