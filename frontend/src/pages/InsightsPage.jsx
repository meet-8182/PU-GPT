import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { 
  Loader2, 
  TrendingUp, 
  BookOpen, 
  Users,
  AlertCircle,
  Clock,
  BarChart2,
  RefreshCw,
  X
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { teacherApi } from '@/utils/api';
import { formatDistanceToNow } from 'date-fns';

const INSIGHT_ACTIONS = {
  gaps: {
    title: 'Content Gaps',
    subtitle: 'Topics where students may need more support',
  },
  trending: {
    title: 'Trending Up',
    subtitle: 'Topics gaining momentum against the previous period',
  },
  activity: {
    title: 'Student Activity',
    subtitle: 'How students are engaging with your subjects',
  },
};

export function InsightsPage() {
  const { user, isAuthenticated, isTeacher, isAdmin } = useAuth();
  const [insights, setInsights] = useState({ topTopics: [], bySubject: [], totalQuestions: 0, periodDays: 7 });
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(7);
  const [activeAction, setActiveAction] = useState(null);
  const [actionData, setActionData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await teacherApi.insights({ days: period });
      setInsights(res.data.insights);
    } catch (err) {
      console.error('Failed to fetch insights:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchInsights();
  }, [isAuthenticated, fetchInsights]);

  const openAction = async (action) => {
    setActiveAction(action);
    setActionData(null);
    setActionError('');
    setActionLoading(true);
    try {
      if (action === 'gaps') {
        const res = await teacherApi.insights({ days: period });
        const topics = res.data?.insights?.topTopics || [];
        const unclassified = topics.find(t => t.topic.toLowerCase() === 'unclassified') || null;
        setActionData({
          topics: topics.filter(t => t.topic.toLowerCase() !== 'unclassified'),
          unclassified,
        });
      } else if (action === 'trending') {
        // Compare this period with the period before it using the existing
        // insights endpoint (cumulative counts make the delta recoverable).
        const [recentRes, longerRes] = await Promise.all([
          teacherApi.insights({ days: period }),
          teacherApi.insights({ days: period * 2 }),
        ]);
        const recent = recentRes.data?.insights?.topTopics || [];
        const longerCounts = new Map(
          (longerRes.data?.insights?.topTopics || []).map(t => [t.topic, t.count])
        );
        const topics = recent
          .map(t => {
            const total = longerCounts.get(t.topic) ?? t.count;
            const previous = Math.max(total - t.count, 0);
            return { ...t, previous, delta: t.count - previous };
          })
          .filter(t => t.delta > 0 && t.topic.toLowerCase() !== 'unclassified')
          .sort((a, b) => b.delta - a.delta);
        setActionData({ topics, comparedDays: period * 2 });
      } else {
        const [currentRes, dayRes] = await Promise.all([
          teacherApi.insights({ days: period }),
          teacherApi.insights({ days: 1 }),
        ]);
        const current = currentRes.data?.insights || {};
        const day = dayRes.data?.insights || {};
        setActionData({
          totalQuestions: current.totalQuestions || 0,
          subjects: current.bySubject || [],
          periodDays: current.periodDays || period,
          lastDayQuestions: day.totalQuestions || 0,
        });
      }
    } catch (err) {
      console.error('Failed to load insight details:', err);
      setActionError('Failed to load this insight. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isTeacher && !isAdmin) {
    return (
      <div className="p-12 text-center">
        <AlertCircle className="w-16 h-16 text-chalk/30 mx-auto mb-4" />
        <h3 className="font-display font-medium text-lg text-chalk mb-2">Access Denied</h3>
        <p className="text-chalk/60">This page is only available for teachers and administrators</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display font-medium text-2xl text-chalk">Topic Insights</h1>
          <p className="text-chalk/60">
            {isTeacher && user?.subjects?.length
              ? `Questions about ${user.subjects.join(', ')}`
              : 'What students are asking about this week'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="px-4 py-2 rounded-lg bg-rule-line/30 border border-rule-line text-chalk focus:outline-none focus:border-amber-chalk teacher-select"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button onClick={fetchInsights} className="btn-secondary" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-chalk/10 rounded-lg flex items-center justify-center">
              <BarChart2 className="w-6 h-6 text-amber-chalk" />
            </div>
            <div>
              <p className="text-2xl font-bold text-chalk">{insights.totalQuestions}</p>
              <p className="text-sm text-chalk/60">Total Questions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-sage/10 rounded-lg flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-sage" />
            </div>
            <div>
              <p className="text-2xl font-bold text-chalk">{insights.bySubject.length}</p>
              <p className="text-sm text-chalk/60">Active Subjects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-chalk/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-amber-chalk" />
            </div>
            <div>
              <p className="text-2xl font-bold text-chalk">{insights.topTopics.length}</p>
              <p className="text-sm text-chalk/60">Top Topics</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-rust/10 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-rust" />
            </div>
            <div>
              <p className="text-2xl font-bold text-chalk">{period}d</p>
              <p className="text-sm text-chalk/60">Analysis Period</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Top Topics
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
              </div>
            ) : insights.topTopics.length === 0 ? (
              <p className="text-chalk/60 text-center py-8">No topics to display</p>
            ) : (
              <div className="space-y-3">
                {insights.topTopics.map((item, index) => (
                  <div key={item.topic} className="flex items-center gap-3">
                    <span className="w-6 text-center text-sm font-medium text-chalk/50">{index + 1}</span>
                    <div className="flex-1">
                      <p className="font-medium text-chalk">{item.topic}</p>
                      <div className="h-2 bg-rule-line rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-amber-chalk" 
                          style={{ width: `${Math.min((item.count / (insights.topTopics[0]?.count || 1)) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm text-chalk/50 font-mono">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Questions by Subject
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
              </div>
            ) : insights.bySubject.length === 0 ? (
              <p className="text-chalk/60 text-center py-8">No subject data</p>
            ) : (
              <div className="space-y-3">
                {insights.bySubject.map((item, index) => (
                  <div key={item.subject} className="flex items-center gap-3">
                    <span className="w-6 text-center text-sm font-medium text-chalk/50">{index + 1}</span>
                    <div className="flex-1">
                      <p className="font-medium text-chalk">{item.subject}</p>
                      <div className="h-2 bg-rule-line rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-sage" 
                          style={{ width: `${Math.min((item.count / (insights.bySubject[0]?.count || 1)) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm text-chalk/50 font-mono">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button type="button" onClick={() => openAction('gaps')} aria-haspopup="dialog" className="btn-secondary text-left p-4 hover:bg-rule-line/50 transition-colors">
              <div className="w-10 h-10 bg-sage/10 rounded-lg flex items-center justify-center mb-2">
                <BookOpen className="w-5 h-5 text-sage" />
              </div>
              <p className="font-medium text-chalk">Content Gaps</p>
              <p className="text-sm text-chalk/60">Identify missing topics</p>
            </button>
            <button type="button" onClick={() => openAction('trending')} aria-haspopup="dialog" className="btn-secondary text-left p-4 hover:bg-rule-line/50 transition-colors">
              <div className="w-10 h-10 bg-rust/10 rounded-lg flex items-center justify-center mb-2">
                <TrendingUp className="w-5 h-5 text-rust" />
              </div>
              <p className="font-medium text-chalk">Trending Up</p>
              <p className="text-sm text-chalk/60">Fastest growing topics</p>
            </button>
            <button type="button" onClick={() => openAction('activity')} aria-haspopup="dialog" className="btn-secondary text-left p-4 hover:bg-rule-line/50 transition-colors">
              <div className="w-10 h-10 bg-amber-chalk/10 rounded-lg flex items-center justify-center mb-2">
                <Users className="w-5 h-5 text-amber-chalk" />
              </div>
              <p className="font-medium text-chalk">Student Activity</p>
              <p className="text-sm text-chalk/60">View engagement trends</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {activeAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in"
          onClick={() => setActiveAction(null)}
        >
          <div
            className="w-full max-w-lg bg-chalkboard border border-rule-line rounded-xl p-6 animate-in max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label={INSIGHT_ACTIONS[activeAction].title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display font-medium text-xl text-chalk">{INSIGHT_ACTIONS[activeAction].title}</h2>
                <p className="text-sm text-chalk/60">{INSIGHT_ACTIONS[activeAction].subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAction(null)}
                className="p-1 text-chalk/50 hover:text-chalk"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
              </div>
            ) : actionError ? (
              <div className="p-3 bg-rust/10 border border-rust/30 rounded-lg text-rust text-sm" role="alert">
                {actionError}
              </div>
            ) : activeAction === 'gaps' ? (
              actionData?.topics?.length === 0 && !actionData?.unclassified ? (
                <p className="text-chalk/60 text-center py-8">No topic gaps detected for this period</p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {actionData?.topics?.map(item => (
                      <div key={item.topic}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-chalk truncate">{item.topic}</p>
                          <span className="text-sm text-chalk/50 font-mono">{item.count}</span>
                        </div>
                        <div className="h-2 bg-rule-line rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full bg-sage"
                            style={{ width: `${Math.min((item.count / (actionData.topics[0]?.count || 1)) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {actionData?.unclassified && (
                    <div className="p-3 bg-amber-chalk/5 border border-amber-chalk/20 rounded-lg text-sm text-chalk/70">
                      <span className="font-medium text-chalk">{actionData.unclassified.count} questions</span>{' '}
                      could not be matched to an uploaded course topic. Consider adding material that covers them.
                    </div>
                  )}
                  <p className="text-xs text-chalk/50">
                    Topics with the most student questions are listed first — these are the areas where students may need more support.
                  </p>
                </div>
              )
            ) : activeAction === 'trending' ? (
              actionData?.topics?.length === 0 ? (
                <p className="text-chalk/60 text-center py-8">
                  No topics are trending up compared with the previous {actionData?.comparedDays} days
                </p>
              ) : (
                <div className="space-y-3">
                  {actionData.topics.map(item => (
                    <div key={item.topic} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-rule-line/20">
                      <div className="min-w-0">
                        <p className="font-medium text-chalk truncate">{item.topic}</p>
                        <p className="text-xs text-chalk/50">{item.previous} previous → {item.count} recent</p>
                      </div>
                      <span className="text-sm font-mono text-sage flex-shrink-0">+{item.delta}</span>
                    </div>
                  ))}
                  <p className="text-xs text-chalk/50">
                    Recent {period} days compared with the {period} days before that.
                  </p>
                </div>
              )
            ) : (
              !actionData || actionData.totalQuestions === 0 ? (
                <p className="text-chalk/60 text-center py-8">No student activity in this period</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 rounded-lg bg-rule-line/20">
                      <p className="text-xl font-bold text-chalk">{actionData.totalQuestions}</p>
                      <p className="text-xs text-chalk/60">Questions ({actionData.periodDays}d)</p>
                    </div>
                    <div className="p-3 rounded-lg bg-rule-line/20">
                      <p className="text-xl font-bold text-chalk">{actionData.subjects.length}</p>
                      <p className="text-xs text-chalk/60">Active subjects</p>
                    </div>
                    <div className="p-3 rounded-lg bg-rule-line/20">
                      <p className="text-xl font-bold text-chalk">{Math.round((actionData.totalQuestions / actionData.periodDays) * 10) / 10}</p>
                      <p className="text-xs text-chalk/60">Avg questions / day</p>
                    </div>
                    <div className="p-3 rounded-lg bg-rule-line/20">
                      <p className="text-xl font-bold text-chalk">{actionData.lastDayQuestions}</p>
                      <p className="text-xs text-chalk/60">Last 24 hours</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {actionData.subjects.map(item => (
                      <div key={item.subject}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-chalk truncate">{item.subject}</p>
                          <span className="text-sm text-chalk/50 font-mono">{item.count}</span>
                        </div>
                        <div className="h-2 bg-rule-line rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full bg-amber-chalk"
                            style={{ width: `${Math.min((item.count / (actionData.subjects[0]?.count || 1)) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}



