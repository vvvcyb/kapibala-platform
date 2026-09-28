import { useState, useEffect, useCallback } from 'react';
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
  const [showQuickTest, setShowQuickTest] = useState(true);

  // Load initial accounts and groups
  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [accs, grps] = await Promise.all([api.getAccounts(), api.getGroups()]);
      setAccounts(accs);
      setGroups(grps);
    } catch (err) {
      console.error('Failed to load accounts/groups:', err);
    }
  }, [currentUser]);

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
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    wsClient.disconnect();
    setWsConnected(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Login Modal when not authenticated */}
      {!currentUser && <LoginModal onLoginSuccess={handleLoginSuccess} />}

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
              onRefreshGroups={loadData}
            />
          </main>

          {/* Quick Test Bar Simulator Widget */}
          <QuickTestBar
            currentGroup={groups[0] || null}
            isOpen={showQuickTest}
            onClose={() => setShowQuickTest(false)}
          />
        </>
      )}
    </div>
  );
}

export default App;
