import React, { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Wrench,
  CheckCircle2,
  AlertOctagon,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Code2,
  Sparkles,
  FileText,
} from 'lucide-react';
import { AgentRun, AgentRunStep, api } from '../lib/api';

interface AgentRunDrawerProps {
  runId: string | null;
  onClose: () => void;
}

export const AgentRunDrawer: React.FC<AgentRunDrawerProps> = ({ runId, onClose }) => {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }

    setLoading(true);
    api
      .getAgentRun(runId)
      .then((data) => {
        setRun(data);
      })
      .catch((err) => {
        console.error('Failed to load agent run details:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId]);

  if (!runId) return null;

  const toggleExpand = (index: number) => {
    setExpandedSteps((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const getStatusBadge = (status: AgentRun['status']) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-spin" />
            运行中 (Running)
          </span>
        );
      case 'finished':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            已完成 (Finished)
          </span>
        );
      case 'blocked':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            安全审计阻塞 (Blocked)
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            失败 (Failed)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Agent 运行决策抽屉 (SPEC 4.4)</h3>
              </div>
              <p className="text-xs text-slate-400 font-mono">Run ID: {runId}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && !run ? (
            <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">正在加载 Agent 运行记录...</span>
            </div>
          ) : !run ? (
            <div className="text-center py-20 text-slate-500 text-sm">未能找到该运行记录</div>
          ) : (
            <>
              {/* Summary Card */}
              <div
                className={`p-4 rounded-xl border ${
                  run.status === 'blocked'
                    ? 'bg-rose-950/30 border-rose-500/50 shadow-lg shadow-rose-950/40'
                    : 'bg-slate-950/50 border-slate-800'
                } space-y-3`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">运行状态:</span>
                    {getStatusBadge(run.status)}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                {run.status === 'blocked' && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-rose-300 text-xs">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                    <div>
                      <p className="font-bold text-rose-200">触发内容安全审计硬阻塞！</p>
                      <p className="mt-0.5 text-rose-300/90 leading-relaxed">
                        Agent 尝试调用的工具或生成的消息未通过合规审查（连续 3 次重试失败），已被中央守护机制彻底拦截。
                      </p>
                    </div>
                  </div>
                )}

                {run.summary && (
                  <div className="text-xs text-slate-300 bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block mb-1">执行摘要:</span>
                    {run.summary}
                  </div>
                )}

                {run.endReason && (
                  <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono">
                    <span className="text-slate-500">终止原因:</span>
                    <span className="text-indigo-300">{run.endReason}</span>
                  </div>
                )}
              </div>

              {/* Execution Steps Timeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    步骤执行时序记录 ({run.steps?.length || 0} 步)
                  </h4>
                </div>

                {(!run.steps || run.steps.length === 0) ? (
                  <div className="p-6 rounded-xl bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500">
                    尚无步骤产生或正在等待 Agent 第一轮思考...
                  </div>
                ) : (
                  <div className="space-y-3 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                    {run.steps.map((step: AgentRunStep) => {
                      const isExpanded = expandedSteps[step.index] || false;
                      const isToolUse = step.kind === 'tool_use';
                      const isProtocolError = step.kind === 'protocol_error';
                      const isFinal = step.kind === 'final';

                      return (
                        <div key={step.index} className="relative pl-8 space-y-2">
                          {/* Dot on timeline */}
                          <div
                            className={`absolute left-2 top-3 w-3 h-3 rounded-full -translate-x-1/2 border-2 ${
                              step.auditVerdict === 'fail'
                                ? 'bg-rose-500 border-rose-900'
                                : isFinal
                                ? 'bg-emerald-500 border-emerald-900'
                                : isProtocolError
                                ? 'bg-amber-500 border-amber-900'
                                : 'bg-indigo-500 border-indigo-900'
                            }`}
                          />

                          {/* Step Card */}
                          <div
                            className={`rounded-xl border p-4 transition-all ${
                              step.auditVerdict === 'fail'
                                ? 'bg-rose-950/20 border-rose-800/60'
                                : isProtocolError
                                ? 'bg-amber-950/20 border-amber-800/50'
                                : 'bg-slate-950/60 border-slate-800'
                            }`}
                          >
                            {/* Step Header */}
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-slate-300">
                                  #{step.index}
                                </span>

                                {/* Kind Badge */}
                                {isToolUse && (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-medium">
                                    <Wrench className="w-3 h-3 text-indigo-400" />
                                    工具调用
                                  </span>
                                )}
                                {isFinal && (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-medium">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    最终响应
                                  </span>
                                )}
                                {isProtocolError && (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 text-xs font-medium">
                                    <AlertOctagon className="w-3 h-3 text-rose-400" />
                                    协议错误
                                  </span>
                                )}

                                {/* Tool Name */}
                                {step.name && (
                                  <span className="font-mono text-xs font-bold text-white bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                                    {step.name}
                                  </span>
                                )}
                              </div>

                              {/* Safety Audit Verdict Badge */}
                              {step.auditVerdict && (
                                <div>
                                  {step.auditVerdict === 'pass' ? (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">
                                      <ShieldCheck className="w-3 h-3" />
                                      审计通过 (Audit: Pass)
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[11px] font-bold animate-pulse">
                                      <ShieldAlert className="w-3 h-3" />
                                      审计拦截 (Audit: Fail)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Step Body */}
                            <div className="mt-3 space-y-2 text-xs">
                              {/* Summary / Result */}
                              {step.resultSummary && (
                                <div className="text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                                  <span className="text-slate-500 block text-[11px] mb-0.5">执行结果:</span>
                                  {step.resultSummary}
                                </div>
                              )}

                              {/* Tool Input JSON */}
                              {step.input && Object.keys(step.input).length > 0 && (
                                <div className="space-y-1">
                                  <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                                    <Code2 className="w-3 h-3 text-indigo-400" />
                                    参数 (Tool Input):
                                  </span>
                                  <pre className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-indigo-200 overflow-x-auto">
                                    {JSON.stringify(step.input, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {/* Error or Protocol Error Details */}
                              {isProtocolError && (
                                <div className="space-y-2">
                                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                                    <span className="font-semibold block">错误原因:</span>
                                    {step.resultSummary || step.errorCode || 'Anthropic API 格式或协议解析失败'}
                                  </div>

                                  {/* Expand Raw Response Button */}
                                  {step.rawResponse && (
                                    <div>
                                      <button
                                        type="button"
                                        onClick={() => toggleExpand(step.index)}
                                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-mono py-1"
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronRight className="w-3.5 h-3.5" />
                                        )}
                                        <FileText className="w-3 h-3 text-amber-400" />
                                        <span>{isExpanded ? '收起原始响应 (rawResponse)' : '展开查看原始响应 (rawResponse)'}</span>
                                      </button>

                                      {isExpanded && (
                                        <pre className="mt-1 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                                          {step.rawResponse}
                                        </pre>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
