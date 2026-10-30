import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  History,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  MessageSquare,
  Loader2,
  AlertCircle,
  Upload,
  BarChart2,
  Users,
  Database,
  LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { chatApi } from '@/utils/api';

const studentNavItems = [
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

const teacherNavItems = [
  { path: '/library', label: 'Content Library', icon: Upload },
  { path: '/insights', label: 'Topic Insights', icon: BarChart2 },
];

const adminNavItems = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/departments', label: 'Departments', icon: Database },
  { path: '/admin/users', label: 'User Management', icon: Users },
  { path: '/admin/status', label: 'System Status', icon: Settings },
];

export function Sidebar({ collapsed = false, onCollapseChange }) {
  const { user, logout, isTeacher, isAdmin, isStudent } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = isAdmin ? adminNavItems : isTeacher ? teacherNavItems : studentNavItems;

  // Recent conversations dropdown state
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [recentConversations, setRecentConversations] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState(null);
  const [fetched, setFetched] = useState(false);

  // Fetch recent conversations for dropdown (only once on mount)
  const fetchRecentConversations = useCallback(async () => {
    if (!isStudent || fetched) return;
    setRecentLoading(true);
    setRecentError(null);
    try {
      const res = await chatApi.history({ limit: 5, page: 1 });
      setRecentConversations(res.data.conversations || []);
      setFetched(true);
    } catch (err) {
      console.error('Failed to fetch recent conversations:', err);
      setRecentError('Failed to load recent chats');
    } finally {
      setRecentLoading(false);
    }
  }, [isStudent, fetched]);

  // Fetch on mount
  useEffect(() => {
    if (isStudent) {
      fetchRecentConversations();
    }
  }, [isStudent, fetchRecentConversations]);

  const handleNewChat = () => {
    navigate('/ask?new=true', { replace: true });
  };

  const handleHistoryArrowClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setHistoryExpanded(!historyExpanded);
  };

  const handleConversationClick = (conversationId, e) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't collapse dropdown immediately - let navigation happen first
    // The dropdown will close naturally when the Ask page loads
    navigate(`/ask?conversation=${conversationId}`);
  };

  return (
    <aside className={`fixed left-0 top-0 h-full bg-rule-line/20 border-r border-rule-line transition-all duration-300 z-40 flex flex-col ${collapsed ? 'w-16' : 'w-64'}`}>
      <div className="flex items-center justify-between h-16 px-4 border-b border-rule-line flex-shrink-0">
        {!collapsed && (
          <NavLink to={isAdmin ? '/admin/dashboard' : isTeacher ? '/library' : '/ask'} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-chalk rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-chalkboard" />
            </div>
            <span className="font-display font-medium text-lg text-chalk">PU-GPT</span>
          </NavLink>
        )}
        <button
          onClick={() => onCollapseChange?.(!collapsed)}
          className="p-2 text-chalk/50 hover:text-chalk hover:bg-rule-line rounded-lg transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation area - scrollable */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" role="navigation" aria-label="Main navigation">
        <div className="flex flex-col space-y-1">
          {/* New Chat - at the top for students */}
          {!collapsed && isStudent && (
            <button
              onClick={handleNewChat}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-chalk/70 hover:text-amber-chalk hover:bg-amber-chalk/10 w-full"
              aria-label="Start new chat"
              title="New Chat"
            >
              <Plus className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <span>New Chat</span>
            </button>
          )}

          {/* Navigation items */}
          {items.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path + '/'));
            const Icon = item.icon;

            // Special handling for History to add dropdown
            if (item.path === '/history' && isStudent && !collapsed) {
              return (
                <div key={item.path}>
                  <button
                    type="button"
                    onClick={handleHistoryArrowClick}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 w-full ${
                      isActive
                        ? 'bg-amber-chalk/15 text-amber-chalk border-l-2 border-amber-chalk'
                        : 'text-chalk/70 hover:text-chalk hover:bg-rule-line/50'
                    }`}
                    aria-expanded={historyExpanded}
                    aria-controls="history-dropdown"
                    aria-haspopup="true"
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                        historyExpanded ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {/* Dropdown for recent conversations - conditional rendering */}
                  {historyExpanded && (
                    <div
                      id="history-dropdown"
                      role="menu"
                      className="mt-1 ml-8 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200"
                    >
                      {recentLoading && (
                        <div className="flex items-center justify-center p-3">
                          <Loader2 className="w-5 h-5 animate-spin text-amber-chalk" />
                        </div>
                      )}
                      {recentError && (
                        <div className="p-3 text-center text-rust text-sm" role="alert">
                          <AlertCircle className="w-4 h-4 mx-auto mb-1" />
                          <p>{recentError}</p>
                        </div>
                      )}
                      {!recentLoading && !recentError && recentConversations.length === 0 && (
                        <div className="p-3 text-center text-chalk/50 text-sm">
                          No recent chats yet
                        </div>
                      )}
                      {!recentLoading && !recentError && recentConversations.length > 0 && (
                        <>
                          {recentConversations.map((conv) => {
                              // Use URLSearchParams for reliable conversation ID matching
                              const urlParams = new URLSearchParams(location.search);
                              const isActiveConv = urlParams.get('conversation') === conv.id;
                              return (
                                <button
                                  key={conv.id}
                                  onClick={(e) => handleConversationClick(conv.id, e)}
                                  role="menuitem"
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors w-full text-left ${
                                    isActiveConv
                                      ? 'bg-amber-chalk/15 text-amber-chalk'
                                      : 'text-chalk/70 hover:text-chalk hover:bg-rule-line/50'
                                  }`}
                                  title={conv.title || 'Untitled conversation'}
                                >
                                  <MessageSquare className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                  <span className="truncate flex-1">
                                    {conv.title || 'Untitled conversation'}
                                  </span>
                                </button>
                              );
                            })}
                          <button
                            type="button"
                            onClick={() => {
                              navigate('/history');
                              setHistoryExpanded(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-chalk/60 hover:text-amber-chalk hover:bg-amber-chalk/10 transition-colors border-t border-rule-line mt-1 w-full text-left"
                            role="menuitem"
                          >
                            <span className="flex-1 text-left">View all history</span>
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            // Regular nav items
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-amber-chalk/15 text-amber-chalk border-l-2 border-amber-chalk'
                    : 'text-chalk/70 hover:text-chalk hover:bg-rule-line/50'
                } ${collapsed ? 'justify-center' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Account section - anchored to bottom */}
      <div className="p-4 border-t border-rule-line flex-shrink-0">
        {!collapsed && (
          <div className="mb-3 px-3">
            <p className="text-xs font-medium text-chalk/50 uppercase tracking-wider mb-2">Account</p>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-rule-line/50">
              <div className="w-8 h-8 bg-amber-chalk/20 rounded-full flex items-center justify-center">
                <span className="text-amber-chalk font-medium text-sm">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-chalk truncate">{user?.name}</p>
                <p className="text-xs text-chalk/50 capitalize">{user?.role}</p>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-chalk/70 hover:text-rust hover:bg-rust/10 transition-all duration-200 w-full ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Log out' : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  );
}