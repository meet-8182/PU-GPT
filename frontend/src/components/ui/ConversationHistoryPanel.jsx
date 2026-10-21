import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { chatApi } from '@/utils/api';
import { formatDistanceToNow } from 'date-fns';

export function ConversationHistoryPanel({ 
  conversationId, 
  onLoadMessages, 
  onClose,
  subject 
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, hasMore: false });
  const [showPanel, setShowPanel] = useState(true);
  const observerRef = useRef(null);
  const loadMoreRef = useRef(null);

  const loadMessages = useCallback(async (page = 1, append = false) => {
    if (!conversationId) return;
    
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    try {
      const res = await chatApi.getConversationMessages(conversationId, { 
        page, 
        limit: pagination.limit 
      });
      
      const newMessages = res.data.messages || [];
      const total = res.data.total || 0;
      const hasMore = res.data.hasMore || false;
      
      if (append) {
        setMessages(prev => [...prev, ...newMessages]);
      } else {
        setMessages(newMessages);
      }
      
      setPagination(prev => ({
        ...prev,
        page: res.data.page,
        total,
        hasMore,
      }));
    } catch (err) {
      console.error('Failed to load conversation messages:', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [conversationId, pagination.limit]);

  // Initial load
  useEffect(() => {
    if (conversationId) {
      loadMessages(1, false);
    } else {
      setMessages([]);
    }
  }, [conversationId, loadMessages]);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && pagination.hasMore && !loadingMore && !loading) {
          loadMessages(pagination.page + 1, true);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [pagination.hasMore, pagination.page, loadingMore, loading, loadMessages]);

  // Notify parent when messages are loaded
  useEffect(() => {
    if (onLoadMessages && messages.length > 0) {
      onLoadMessages(messages);
    }
  }, [messages, onLoadMessages]);

  if (!showPanel && !conversationId) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-40 bg-chalkboard border-l border-rule-line flex flex-col transition-all duration-300 max-w-md w-full">
      {/* Panel Header */}
      <div className="flex items-center justify-between p-4 border-b border-rule-line bg-rule-line/20">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-amber-chalk" />
          <h3 className="font-display font-medium text-lg text-chalk">Conversation History</h3>
        </div>
        <button
          onClick={() => onClose?.()}
          className="p-2 text-chalk/50 hover:text-chalk hover:bg-rule-line rounded-lg transition-colors"
          aria-label="Close history panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="text-center text-rust py-8">
            <p className="mb-2">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => loadMessages(1, false)}>
              Retry
            </Button>
          </div>
        )}

        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-amber-chalk" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-chalk/50 py-8">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-chalk/20" />
            <p className="text-sm">No messages in this conversation</p>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <div 
                key={`${msg._id || index}-${msg.timestamp}`} 
                className="animate-in fade-in"
              >
                <div className="flex gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user' ? 'bg-amber-chalk/20' : 'bg-sage/20'
                  }`}>
                    {msg.role === 'user' ? (
                      <span className="text-amber-chalk text-xs font-medium">
                        {subject?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-sage" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-sm text-chalk">
                        {msg.role === 'user' ? 'You' : 'Assistant'}
                      </span>
                      <span className="text-xs text-chalk/40 whitespace-nowrap">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-chalk/80 text-sm line-clamp-2">
                      {msg.content}
                    </div>
                    {msg.citations?.length > 0 && (
                      <div className="mt-1 flex gap-1">
                        {msg.citations.slice(0, 2).map((cite, i) => (
                          <span key={i} className="px-1.5 py-0.5 text-xs bg-amber-chalk/10 text-amber-chalk rounded border border-amber-chalk/20">
                            [{cite.page || cite.chunkId || i + 1}]
                          </span>
                        ))}
                        {msg.citations.length > 2 && (
                          <span className="px-1.5 py-0.5 text-xs bg-chalk/10 text-chalk/50 rounded">
                            +{msg.citations.length - 2} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Load more trigger */}
            <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
              {loadingMore && (
                <Loader2 className="w-5 h-5 animate-spin text-amber-chalk" />
              )}
              {pagination.hasMore && !loadingMore && (
                <p className="text-xs text-chalk/40">Scroll up to load more messages</p>
              )}
              {!pagination.hasMore && messages.length > 0 && (
                <p className="text-xs text-chalk/40">End of conversation</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Message count footer */}
      <div className="p-3 border-t border-rule-line bg-rule-line/20">
        <p className="text-xs text-chalk/50 text-center">
          {pagination.total} message{pagination.total !== 1 ? 's' : ''} total
        </p>
      </div>
    </div>
  );
}