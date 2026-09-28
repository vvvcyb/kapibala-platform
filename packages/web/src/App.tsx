import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { AuthUser, Account, Group, getCurrentUser, setToken, api } from './lib/api';
import { wsClient } from './lib/ws';
import { Navbar } from './components/Navbar';
import { LoginModal } from './components/LoginModal';
import { AccountsPanel } from './components/AccountsPanel';
import { GroupChatWorkspace } from './components/GroupChatWorkspace';
import { QuickTestBar } from './components/QuickTestBar';

export function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getCurrentUser());
  const [wsConnected, setWsConnected] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [showQuickTest, setShowQuickTest] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [authExpiredMessage, setAuthExpiredMessage] = useState<string | null>(null);

  // Listen to auth_expired event (401 token expired)
  useEffect(() => {
    const handleAuthExpired = () => {
      setToken(null);
      setCurrentUser(null);
      wsClient.disconnect();
      setWsConnected(false);
      setAuthExpiredMessage('登录会话已到期，请重新登录');
      setTimeout(() => {
        setAuthExpiredMessage(null);
      }, 8000);
    };

    window.addEventListener('auth_expired', handleAuthExpired);
    return () => {
      window.removeEventListener('auth_expired', handleAuthExpired);
    };
  }, []);

  // Load initial accounts and groups
  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [accs, grps] = await Promise.all([api.getAccounts(), api.getGroups()]);
      setAccounts(accs);
      setGroups(grps);
      if (grps.length > 0) {
        setSelectedGroupId((prev) => (prev && grps.some((g) => g.id === prev) ? prev : grps[0].id));
      }
    } catch (err) {
      console.error('Failed to load accounts/groups:', err);
    }
  }, [currentUser]);

  const handleTriggerRefresh = useCallback(() => {
    loadData();
    setRefreshTrigger((prev) => prev + 1);
  }, [loadData]);

  // Handle WebSocket connection lifecycle
  useEffect(() => {
    if (currentUser) {
      wsClient.connect();

      // Subscribe to all events to monitor connection status and auto update
      const unsubAll = wsClient.subscribe('*', (payload: { type: string; data: any }) => {
        setWsConnected(true);
        if (payload.type === 'account_updated') {
          setAccounts((prev) =>
            prev.map((acc) => (acc.id === payload.data.id ? { ...acc, ...payload.data } : acc))
          );
        }
      });

      loadData();

      return () => {
        unsubAll();
      };
    } else {
      wsClient.disconnect();
      setWsConnected(false);
    }
  }, [currentUser, loadData]);

  const handleLoginSuccess = () => {
    const user = getCurrentUser();
    setCurrentUser(user);
    setAuthExpiredMessage(null);
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    wsClient.disconnect();
    setWsConnected(false);
  };

  const currentGroup = groups.find((g) => g.id === selectedGroupId) || groups[0] || null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Toast alert on auth expired */}
      {authExpiredMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <span>{authExpiredMessage}</span>
        </div>
      )}

      {/* Login Modal when not authenticated */}
      {!currentUser && (
        <LoginModal
          onLoginSuccess={handleLoginSuccess}
          initialMessage={authExpiredMessage}
        />
      )}

      {/* Main App Layout */}
      {currentUser && (
        <>
          <Navbar
            user={currentUser}
            wsConnected={wsConnected}
            onLogout={handleLogout}
            showQuickTest={showQuickTest}
            onToggleQuickTest={() => setShowQuickTest((v) => !v)}
          />

          <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
            {/* Page 2: Accounts Management Panel */}
            <AccountsPanel
              accounts={accounts}
              currentUser={currentUser}
              onRefresh={loadData}
            />

            {/* Page 3 & SPEC 4.4: Group Chat Workspace & Agent Run Monitor */}
            <GroupChatWorkspace
              groups={groups}
              accounts={accounts}
              currentUser={currentUser}
              selectedGroupId={selectedGroupId || (groups[0]?.id || '')}
              onSelectGroup={setSelectedGroupId}
              onRefreshGroups={handleTriggerRefresh}
              refreshTrigger={refreshTrigger}
            />
          </main>

          {/* Quick Test Bar Simulator Widget */}
          <QuickTestBar
            currentGroup={currentGroup}
            isOpen={showQuickTest}
            onClose={() => setShowQuickTest(false)}
            onRefresh={handleTriggerRefresh}
          />
        </>
      )}
    </div>
  );
}

export default App;
