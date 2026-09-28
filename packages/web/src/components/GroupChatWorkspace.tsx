import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  MessageSquare,
  Bot,
  Send,
  Plus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  User,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  AlertOctagon,
  ChevronUp,
  Lock,
  Sparkles,
} from 'lucide-react';
import {
  Group,
  GroupMember,
  Account,
  MessageItem,
  AgentRun,
  AuthUser,
  api,
} from '../lib/api';
import { wsClient } from '../lib/ws';
import { AgentRunDrawer } from './AgentRunDrawer';
import { CreateGroupModal } from './CreateGroupModal';

interface GroupChatWorkspaceProps {
  groups: Group[];
  accounts: Account[];
  currentUser: AuthUser | null;
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
  onRefreshGroups: () => void;
  refreshTrigger?: number;
}

interface SystemNotice {
  id: string;
  type: 'kick';
  targetUserId: string;
  sentAt: string;
}

type TimelineItem =
  | { kind: 'message'; data: MessageItem; sentAt: string }
  | { kind: 'kick_notice'; data: SystemNotice; sentAt: string };

interface SenderDisplay {
  name: string;
  badgeLabel: string;
  badgeColor: string;
  dotColor: string;
  platformUserId: string;
  isOwnAccount: boolean;
  isSpammer: boolean;
}

export const GroupChatWorkspace: React.FC<GroupChatWorkspaceProps> = ({
  groups,
  accounts,
  currentUser,
  selectedGroupId,
  onSelectGroup,
  onRefreshGroups,
  refreshTrigger = 0,
}) => {
  const isViewer = currentUser?.role === 'viewer';

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [systemNotices, setSystemNotices] = useState<SystemNotice[]>([]);
  const [dynamicMembers, setDynamicMembers] = useState<GroupMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Agent Runs
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Current Group
  const currentGroup = groups.find((g) => g.id === selectedGroupId) || groups[0] || null;

  // Selected sender account among group members
  const groupMemberAccounts = currentGroup
    ? accounts.filter((a) => currentGroup.members.some((m) => m.accountId === a.id))
    : [];
  const onlineMemberAccounts = groupMemberAccounts.filter((a) => a.status === 'online');
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Update default selected group if none selected
  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      onSelectGroup(groups[0].id);
    }
  }, [groups, selectedGroupId, onSelectGroup]);

  // Synchronize dynamic members when currentGroup changes
  useEffect(() => {
    if (currentGroup) {
      setDynamicMembers([...currentGroup.members]);
    } else {
      setDynamicMembers([]);
    }
    setSystemNotices([]);
  }, [currentGroup?.id]);

  // Update default sender account when current group changes
  useEffect(() => {
    if (onlineMemberAccounts.length > 0) {
      if (!onlineMemberAccounts.some((a) => a.id === selectedSenderId)) {
        setSelectedSenderId(onlineMemberAccounts[0].id);
      }
    } else if (groupMemberAccounts.length > 0) {
      if (!groupMemberAccounts.some((a) => a.id === selectedSenderId)) {
        setSelectedSenderId(groupMemberAccounts[0].id);
      }
    }
  }, [currentGroup, accounts]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const addKickNotice = (targetUserId: string) => {
    if (!targetUserId) return;
    const noticeId = `kick_${targetUserId}_${Date.now()}`;
    setSystemNotices((prev) => {
      const recent = prev.some(
        (n) => n.targetUserId === targetUserId && Math.abs(Date.now() - new Date(n.sentAt).getTime()) < 10000
      );
      if (recent) return prev;
      return [
        ...prev,
        {
          id: noticeId,
          type: 'kick',
          targetUserId,
          sentAt: new Date().toISOString(),
        },
      ];
    });
    scrollToBottom();
  };

  const extractKicksFromRuns = (runs: AgentRun[]): SystemNotice[] => {
    const kicks: SystemNotice[] = [];
    for (const run of runs) {
      if (run.steps) {
        for (const step of run.steps) {
          if (step.name === 'kick_user' && (step.auditVerdict === 'pass' || !step.isError)) {
            const target = String(
              step.input?.platform_user_id ||
              step.input?.targetPlatformUserId ||
              step.input?.platformUserId ||
              ''
            );
            if (target && !kicks.some((k) => k.targetUserId === target)) {
              kicks.push({
                id: `kick_run_${run.id}_${step.index}`,
                type: 'kick',
                targetUserId: target,
                sentAt: step.createdAt || run.updatedAt || run.createdAt,
              });
            }
          }
        }
      }
    }
    return kicks;
  };

  // Load initial messages and agent runs when group changes or refresh triggered
  const loadGroupData = () => {
    if (!currentGroup) return;

    // Load messages
    api
      .getMessages(currentGroup.id, undefined, 20)
      .then((data) => {
        setMessages(data.items);
        setNextCursor(data.nextCursor);
        scrollToBottom();
      })
      .catch((err) => {
        console.error('Failed to load group messages:', err);
      });

    // Load agent runs
    api
      .getGroupAgentRuns(currentGroup.id)
      .then((runs) => {
        setAgentRuns(runs);
        const discoveredKicks = extractKicksFromRuns(runs);
        if (discoveredKicks.length > 0) {
          setSystemNotices((prev) => {
            const existingTargets = new Set(prev.map((n) => n.targetUserId));
            const newItems = discoveredKicks.filter((k) => !existingTargets.has(k.targetUserId));
            return [...prev, ...newItems];
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load group agent runs:', err);
      });
  };

  useEffect(() => {
    loadGroupData();
  }, [currentGroup?.id, refreshTrigger]);

  // WebSocket subscriptions for realtime events
  useEffect(() => {
    const unsubNewMessage = wsClient.subscribe('message_new', (data: any) => {
      const msg: MessageItem = data?.message || data;
      if (!msg) return;
      const gId = data?.groupId || (msg as any)?.groupId;
      if (currentGroup && gId && gId !== currentGroup.id) return;

      setMessages((prev) => {
        const exists = prev.some(
          (m) =>
            (m.id && msg.id && m.id === msg.id) ||
            (m.clientMsgId && msg.clientMsgId && m.clientMsgId === msg.clientMsgId) ||
            (m.msgId && msg.msgId && m.msgId === msg.msgId)
        );
        if (exists) {
          return prev.map((m) =>
            (m.id && msg.id && m.id === msg.id) ||
            (m.clientMsgId && msg.clientMsgId && m.clientMsgId === msg.clientMsgId) ||
            (m.msgId && msg.msgId && m.msgId === msg.msgId)
              ? { ...m, ...msg }
              : m
          );
        }
        return [...prev, msg];
      });
      scrollToBottom();
    });

    const unsubUpdatedMessage = wsClient.subscribe('message_updated', (data: any) => {
      const msg: MessageItem = data?.message || data;
      if (!msg) return;
      const gId = data?.groupId || (msg as any)?.groupId;
      if (currentGroup && gId && gId !== currentGroup.id) return;

      setMessages((prev) =>
        prev.map((m) =>
          (m.id && msg.id && m.id === msg.id) ||
          (m.clientMsgId && msg.clientMsgId && m.clientMsgId === msg.clientMsgId) ||
          (m.msgId && msg.msgId && m.msgId === msg.msgId)
            ? { ...m, ...msg }
            : m
        )
      );
    });

    const unsubAgentStarted = wsClient.subscribe('agent_run_started', (data: any) => {
      const run: AgentRun = data?.run || data;
      if (!run || !run.id) return;
      const gId = data?.groupId || run?.groupId;
      if (currentGroup && gId && gId !== currentGroup.id) return;

      setAgentRuns((prev) => {
        const exists = prev.some((r) => r.id === run.id);
        if (exists) {
          return prev.map((r) => (r.id === run.id ? { ...r, ...run } : r));
        }
        return [run, ...prev];
      });
    });

    const unsubAgentStep = wsClient.subscribe('agent_run_step', (data: any) => {
      const runId = data?.runId;
      const step = data?.step;
      if (!runId || !step) return;

      const gId = data?.groupId;
      if (gId && currentGroup && gId !== currentGroup.id) return;

      // Check if step executed kick_user successfully
      if (step.name === 'kick_user' && (step.auditVerdict === 'pass' || !step.isError)) {
        const target = String(
          step.input?.platform_user_id ||
          step.input?.targetPlatformUserId ||
          step.input?.platformUserId ||
          ''
        );
        if (target) {
          setDynamicMembers((prev) => prev.filter((m) => m.platformUserId !== target));
          addKickNotice(target);
        }
      }

      setAgentRuns((prev) => {
        const existingRun = prev.find((r) => r.id === runId);
        if (existingRun) {
          const steps = existingRun.steps || [];
          const stepExists = steps.some((s) => s.index === step.index);
          const updatedSteps = stepExists
            ? steps.map((s) => (s.index === step.index ? step : s))
            : [...steps, step];
          return prev.map((r) => (r.id === runId ? { ...r, steps: updatedSteps } : r));
        } else {
          return [
            {
              id: runId,
              groupId: currentGroup?.id || '',
              status: 'running',
              endReason: null,
              summary: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              steps: [step],
            },
            ...prev,
          ];
        }
      });
    });

    const unsubAgentFinished = wsClient.subscribe('agent_run_finished', (data: any) => {
      const runId = data?.runId || data?.id;
      if (!runId) return;

      const gId = data?.groupId;
      if (gId && currentGroup && gId !== currentGroup.id) return;

      const status = data?.status;
      const endReason = data?.endReason;
      const summary = data?.summary;

      setAgentRuns((prev) => {
        const exists = prev.some((r) => r.id === runId);
        if (exists) {
          return prev.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  status: status || r.status,
                  endReason: endReason !== undefined ? endReason : r.endReason,
                  summary: summary !== undefined ? summary : r.summary,
                  updatedAt: new Date().toISOString(),
                }
              : r
          );
        } else {
          return [
            {
              id: runId,
              groupId: gId || currentGroup?.id || '',
              status: status || 'finished',
              endReason: endReason || null,
              summary: summary || null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              steps: [],
            },
            ...prev,
          ];
        }
      });
    });

    const unsubGroupUpdated = wsClient.subscribe('group_updated', (data: any) => {
      if (!currentGroup || data.groupId !== currentGroup.id) return;

      if (data.action === 'member_joined' && data.platformUserId) {
        setDynamicMembers((prev) => {
          if (prev.some((m) => m.platformUserId === data.platformUserId)) return prev;
          return [
            ...prev,
            {
              accountId: data.platformUserId,
              platformUserId: data.platformUserId,
              role: 'member',
            },
          ];
        });
      } else if (data.action === 'member_left' && data.platformUserId) {
        setDynamicMembers((prev) => prev.filter((m) => m.platformUserId !== data.platformUserId));
        addKickNotice(data.platformUserId);
      }
    });

    return () => {
      unsubNewMessage();
      unsubUpdatedMessage();
      unsubAgentStarted();
      unsubAgentStep();
      unsubAgentFinished();
      unsubGroupUpdated();
    };
  }, [currentGroup?.id]);

  // Load earlier messages using nextCursor
  const handleLoadEarlier = async () => {
    if (!currentGroup || !nextCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const data = await api.getMessages(currentGroup.id, nextCursor, 20);
      setMessages((prev) => {
        const prevIds = new Set(prev.map((m) => m.id));
        const newUnique = data.items.filter((m) => !prevIds.has(m.id));
        return [...newUnique, ...prev];
      });
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load earlier messages:', err);
    } finally {
      setLoadingEarlier(false);
    }
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isViewer) return;
    if (!inputText.trim() || !currentGroup || !selectedSenderId || sending) return;

    setSending(true);
    setSendError(null);
    const textToSend = inputText.trim();
    setInputText('');

    try {
      await api.sendMessage(currentGroup.id, selectedSenderId, textToSend);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setSendError(e.message || '消息发送失败');
      setInputText(textToSend); // Restore
    } finally {
      setSending(false);
    }
  };

  // Toggle group settings (agentEnabled / autoKickEnabled)
  const handleToggleSetting = async (key: 'agentEnabled' | 'autoKickEnabled') => {
    if (isViewer || !currentGroup) return;
    try {
      const nextVal = !currentGroup[key];
      await api.updateGroupSettings(currentGroup.id, { [key]: nextVal });
      onRefreshGroups();
    } catch (err) {
      console.error(`Failed to update ${key}:`, err);
    }
  };

  // Sender Metadata Resolver
  const getSenderDisplay = (senderPlatformUserId: string, text: string): SenderDisplay => {
    const matchedAccount = accounts.find(
      (a) =>
        a.platformUserId === senderPlatformUserId ||
        a.id === senderPlatformUserId ||
        senderPlatformUserId === `u_${a.id}`
    );

    const memberInfo = currentGroup?.members.find(
      (m) =>
        m.platformUserId === senderPlatformUserId ||
        (matchedAccount && m.accountId === matchedAccount.id)
    );

    const isSpammer =
      senderPlatformUserId.toLowerCase().includes('spammer') ||
      text.includes('兼职') ||
      text.includes('刷单') ||
      text.includes('彩金') ||
      text.includes('微信');

    if (matchedAccount) {
      const role = memberInfo?.role || 'member';
      if (role === 'creator') {
        return {
          name: matchedAccount.id,
          badgeLabel: '群主',
          badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
          dotColor: 'bg-amber-400',
          platformUserId: senderPlatformUserId,
          isOwnAccount: true,
          isSpammer: false,
        };
      } else if (role === 'admin') {
        return {
          name: matchedAccount.id,
          badgeLabel: '管理员',
          badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40',
          dotColor: 'bg-indigo-400',
          platformUserId: senderPlatformUserId,
          isOwnAccount: true,
          isSpammer: false,
        };
      } else {
        return {
          name: matchedAccount.id,
          badgeLabel: '成员',
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
          dotColor: 'bg-emerald-400',
          platformUserId: senderPlatformUserId,
          isOwnAccount: true,
          isSpammer: false,
        };
      }
    }

    // External member / visitor
    if (isSpammer) {
      return {
        name: '外部违规成员',
        badgeLabel: '违规广告嫌疑',
        badgeColor: 'bg-rose-500/25 text-rose-300 border border-rose-500/50 animate-pulse',
        dotColor: 'bg-rose-500',
        platformUserId: senderPlatformUserId,
        isOwnAccount: false,
        isSpammer: true,
      };
    }

    return {
      name: '外部访客',
      badgeLabel: '路人/客户',
      badgeColor: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
      dotColor: 'bg-orange-400',
      platformUserId: senderPlatformUserId,
      isOwnAccount: false,
      isSpammer: false,
    };
  };

  const getDeliveryStatusBadge = (status: MessageItem['deliveryStatus'], failCode?: string | null) => {
    switch (status) {
      case 'queued':
        return (
          <span title="排队中 (Queued)" className="text-slate-400 flex items-center gap-0.5 text-[10px]">
            <Clock className="w-3 h-3" />
            <span>排队</span>
          </span>
        );
      case 'accepted':
        return (
          <span title="网关已受理 (Accepted)" className="text-amber-400 flex items-center gap-0.5 text-[10px]">
            <Check className="w-3 h-3" />
            <span>已受理</span>
          </span>
        );
      case 'sent':
        return (
          <span title="已送达 (Sent)" className="text-emerald-400 flex items-center gap-0.5 text-[10px]">
            <CheckCheck className="w-3 h-3" />
            <span>已送达</span>
          </span>
        );
      case 'failed':
        return (
          <span
            title={`发送失败: ${failCode || '未知错误'}`}
            className="text-rose-400 flex items-center gap-0.5 text-[10px] font-bold"
          >
            <AlertCircle className="w-3 h-3" />
            <span>失败</span>
          </span>
        );
      default:
        return null;
    }
  };

  // Construct chronologically merged timeline items
  const timelineItems: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, data: m, sentAt: m.sentAt })),
    ...systemNotices.map((n) => ({ kind: 'kick_notice' as const, data: n, sentAt: n.sentAt })),
  ].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800/80 shadow-xl overflow-hidden flex flex-col h-[750px]">
      {/* Top Workspace Bar */}
      <div className="border-b border-slate-800/80 bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Group Tabs & Selector */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {groups.length === 0 ? (
              <span className="text-xs text-slate-500 px-3 py-1">暂无可用群组</span>
            ) : (
              groups.map((grp) => {
                const isActive = grp.id === currentGroup?.id;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => onSelectGroup(grp.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {grp.gatewayGroupId || grp.id.slice(0, 8)}
                  </button>
                );
              })
            )}
          </div>

          {/* Create Group Button - HIDDEN FOR VIEWER */}
          {!isViewer && (
            <button
              type="button"
              id="btn-open-create-group"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-medium transition-all shadow-sm shadow-indigo-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>一键异步建群</span>
            </button>
          )}
        </div>

        {/* Right: Group Switches (Agent & AutoKick) */}
        {currentGroup && (
          <div className="flex items-center gap-3">
            {/* Agent Enabled Toggle */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800">
              <Bot className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-300">智能助手</span>
              {isViewer ? (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    currentGroup.agentEnabled ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {currentGroup.agentEnabled ? '开启' : '关闭'}
                </span>
              ) : (
                <button
                  type="button"
                  id="toggle-agent-enabled"
                  onClick={() => handleToggleSetting('agentEnabled')}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                    currentGroup.agentEnabled ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      currentGroup.agentEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              )}
            </div>

            {/* AutoKick Enabled Toggle */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-slate-300">违规自动踢人</span>
              {isViewer ? (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    currentGroup.autoKickEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {currentGroup.autoKickEnabled ? '开启' : '关闭'}
                </span>
              ) : (
                <button
                  type="button"
                  id="toggle-autokick-enabled"
                  onClick={() => handleToggleSetting('autoKickEnabled')}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                    currentGroup.autoKickEnabled ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      currentGroup.autoKickEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Split Layout: Left Members | Center Messages | Right Agent Monitor */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Group Members Sidebar (220px) */}
        <div className="w-56 border-r border-slate-800/80 bg-slate-950/40 p-4 flex flex-col justify-between hidden md:flex">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                群内成员 ({dynamicMembers.length})
              </span>
            </div>

            <div className="space-y-1.5 overflow-y-auto max-h-[580px] pr-1">
              {dynamicMembers.map((m) => {
                const acc = accounts.find((a) => a.id === m.accountId || a.platformUserId === m.platformUserId);
                const isOnline = acc ? acc.status === 'online' : true;
                const isCreator = m.role === 'creator';
                const isAdmin = m.role === 'admin';
                const isSpammer = m.platformUserId.toLowerCase().includes('spammer');

                return (
                  <div
                    key={m.platformUserId || m.accountId}
                    className={`p-2.5 rounded-xl border flex items-center justify-between transition-all duration-300 animate-in fade-in slide-in-from-left-2 ${
                      isSpammer
                        ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                        : 'bg-slate-900/60 border-slate-800/60'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isSpammer
                              ? 'bg-rose-400 animate-pulse'
                              : isOnline
                              ? 'bg-emerald-400 animate-pulse'
                              : 'bg-slate-500'
                          }`}
                        />
                        <span className="font-mono text-xs font-bold text-white">
                          {acc?.id || m.platformUserId}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono pl-3.5">
                        {m.platformUserId}
                      </p>
                    </div>

                    {/* Role Badges */}
                    {isCreator ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-0.5">
                        <Shield className="w-2.5 h-2.5" />
                        群主
                      </span>
                    ) : isAdmin ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold flex items-center gap-0.5">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        管理员
                      </span>
                    ) : isSpammer ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold flex items-center gap-0.5">
                        <AlertOctagon className="w-2.5 h-2.5" />
                        待处置
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-normal">
                        成员
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 font-mono">
            群ID: {currentGroup?.id.slice(0, 12)}...
          </div>
        </div>

        {/* Center: Message Timeline & Send Box */}
        <div className="flex-1 flex flex-col bg-slate-950/20 overflow-hidden">
          {/* Timeline Header Info */}
          <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-800/40 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>实时消息流 (游标分页 + WebSocket 毫秒级推送)</span>
            </span>
            <span className="font-mono text-[11px]">{timelineItems.length} 条已载入</span>
          </div>

          {/* Messages Scroll Area */}
          <div
            ref={messagesContainerRef}
            className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col"
          >
            {/* Load Earlier Button */}
            {nextCursor && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={handleLoadEarlier}
                  disabled={loadingEarlier}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-mono border border-slate-700 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{loadingEarlier ? '加载更早消息中...' : '加载更早消息 (Cursor)'}</span>
                </button>
              </div>
            )}

            {timelineItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-600" />
                <span>该群暂无消息，请在下方发送或使用模拟器注入测试消息</span>
              </div>
            ) : (
              timelineItems.map((item) => {
                if (item.kind === 'kick_notice') {
                  const notice = item.data;
                  return (
                    <div
                      key={notice.id}
                      className="flex justify-center my-3 animate-in fade-in zoom-in-95 duration-300"
                    >
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900 border border-rose-500/40 text-rose-300 text-xs shadow-lg shadow-rose-950/50">
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
                        <span className="font-semibold tracking-wide">
                          🛡️ AI 智能风控介入：检测到垃圾广告违规，已将违规成员 [{notice.targetUserId}] 移出群聊！
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono ml-1">
                          {new Date(notice.sentAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  );
                }

                // Message bubble
                const msg = item.data;
                const sender = getSenderDisplay(msg.senderPlatformUserId, msg.text);
                const isOwn = sender.isOwnAccount;

                return (
                  <div
                    key={msg.id || msg.clientMsgId}
                    className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                  >
                    {/* Sender Header */}
                    <div className={`flex items-center gap-1.5 text-[11px] mb-1 px-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      {isOwn && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(msg.sentAt).toLocaleTimeString()}
                        </span>
                      )}

                      {/* Role and Identity Tag */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold ${sender.badgeColor}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sender.dotColor}`} />
                        <span>{sender.name}</span>
                        <span className="font-normal opacity-80">[{sender.badgeLabel}]</span>
                      </span>

                      <span className="text-[10px] text-slate-500 font-mono">
                        {msg.senderPlatformUserId}
                      </span>

                      {!isOwn && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(msg.sentAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-all ${
                        isOwn
                          ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-md shadow-indigo-950/20'
                          : sender.isSpammer
                          ? 'bg-rose-950/40 text-rose-100 border border-rose-500/50 rounded-tl-none shadow-md shadow-rose-950/40'
                          : 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-tl-none'
                      }`}
                    >
                      {sender.isSpammer && (
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 mb-1 border-b border-rose-800/50 pb-1">
                          <AlertOctagon className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                          <span>违规广告与引流拦截嫌疑</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.text}</p>
                    </div>

                    {/* Delivery Status for Own Messages */}
                    {isOwn && (
                      <div className="mt-1 px-1 flex items-center gap-1">
                        {getDeliveryStatusBadge(msg.deliveryStatus, msg.failCode)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Send Box Area */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/60">
            {sendError && (
              <div className="mb-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{sendError}</span>
              </div>
            )}

            {isViewer ? (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-center gap-2 text-xs text-amber-300/80">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>当前处于「只读观察者模式」，发信与交互已被权限策略禁用</span>
              </div>
            ) : (
              <form onSubmit={handleSendMessage} className="space-y-2">
                <div className="flex items-center gap-2">
                  {/* Sender Account Dropdown */}
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <select
                      id="select-sender-account"
                      value={selectedSenderId}
                      onChange={(e) => setSelectedSenderId(e.target.value)}
                      className="bg-transparent text-xs text-slate-200 font-mono focus:outline-none cursor-pointer"
                    >
                      {groupMemberAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id} className="bg-slate-900">
                          {acc.id} ({acc.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    按 Enter 发送，Shift+Enter 换行
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    id="input-message-text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="输入发信内容..."
                    disabled={sending || !currentGroup}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="submit"
                    id="btn-send-message"
                    disabled={sending || !inputText.trim() || !currentGroup}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {sending ? (
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span className="hidden sm:inline">发送</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right: Agent Run Monitor (SPEC 4.4) (280px) */}
        <div className="w-72 border-l border-slate-800/80 bg-slate-950/40 p-4 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-indigo-400" />
                Agent 决策监视 ({agentRuns.length})
              </span>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </div>

            <div className="space-y-2.5 overflow-y-auto max-h-[580px] pr-1">
              {agentRuns.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 text-center text-xs text-slate-500">
                  当前群组暂无 Agent 触发记录
                </div>
              ) : (
                agentRuns.map((run) => {
                  const isBlocked = run.status === 'blocked';
                  const isRunning = run.status === 'running';

                  return (
                    <div
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${
                        isBlocked
                          ? 'bg-rose-950/30 border-rose-500/60 shadow-md shadow-rose-950/40 animate-pulse'
                          : isRunning
                          ? 'bg-indigo-950/20 border-indigo-500/40 shadow-sm'
                          : 'bg-slate-900/70 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">
                          #{run.id.slice(0, 8)}
                        </span>
                        {isBlocked ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                            <AlertOctagon className="w-3 h-3 text-rose-400" />
                            审计阻塞
                          </span>
                        ) : isRunning ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-spin" />
                            运行中
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                            已完成
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-[11px] text-slate-400 line-clamp-2">
                        {run.summary || (isBlocked ? '内容安全审查未通过，拦截执行' : '思考中...')}
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                        <span>步骤: {run.steps?.length || 0} 步</span>
                        <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 text-center">
            点击卡片展开 SPEC 4.4 运行抽屉
          </div>
        </div>
      </div>

      {/* SPEC 4.4 Agent Run Drawer */}
      <AgentRunDrawer runId={selectedRunId} onClose={() => setSelectedRunId(null)} />

      {/* Async Create Group Wizard Modal */}
      {showCreateModal && (
        <CreateGroupModal
          accounts={accounts}
          onClose={() => setShowCreateModal(false)}
          onGroupCreated={(newGroupId) => {
            onRefreshGroups();
            onSelectGroup(newGroupId);
          }}
        />
      )}
    </div>
  );
};
