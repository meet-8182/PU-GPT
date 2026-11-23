import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Send, Loader2, AlertCircle, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { guestApi } from '@/utils/api';
import { MessageRenderer } from '@/components/ui/MessageRenderer';

const MAX_MESSAGE_CHARS = 500;

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function friendlyError(code, fallback) {
  if (code === 'GUEST_RATE_LIMITED') {
    return 'You have reached the guest question limit. Please wait a moment, or log in for more help.';
  }
  if (code === 'GUEST_BUSY') {
    return 'The assistant is busy right now. Please try again in a minute.';
  }
  if (code === 'BODY_TOO_LARGE') {
    return 'That message is too long. Please keep it under 500 characters.';
  }
  if (code === 'INVALID_INPUT') {
    return 'Please enter a question of up to 500 characters.';
  }
  return fallback || 'Something went wrong. Please try again.';
}

export function GuestPage() {
  const [infoStatus, setInfoStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState([]);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [feedbackSent, setFeedbackSent] = useState({});

  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await guestApi.infoStatus();
      setInfoStatus(res.data);
    } catch (err) {
      console.error('[Guest] Could not load university information status:', err);
      setStatusError('Could not load university information. Please refresh the page.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText, sending]);

  const history = useMemo(() => {
    const turns = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content }));
    return turns;
  }, [messages]);

  const sendMessage = useCallback(async (rawMessage) => {
    const message = String(rawMessage || '').trim();
    if (!message || sending) return;
    if (message.length > MAX_MESSAGE_CHARS) {
      setError(`Please keep your question under ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }

    setError('');
    setStatusText('');
    setStreamingText('');
    setStreamingCitations([]);
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 125000);

    let answer = '';
    let citations = [];
    let hadError = false;

    try {
      const response = await guestApi.ask({ message, history }, controller.signal);

      if (!response.ok) {
        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }
        hadError = true;
        setError(friendlyError(payload.code, payload.error));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content' && event.content) {
              answer += event.content;
              setStreamingText(answer);
            } else if (event.type === 'status') {
              setStatusText(event.status || '');
            } else if (event.type === 'citations') {
              citations = event.citations || [];
              setStreamingCitations(citations);
            } else if (event.type === 'error') {
              hadError = true;
              setError(friendlyError(null, event.message));
            }
          } catch {
            // Ignore malformed frames; the server always sends JSON.
          }
        }
      }

      if (answer.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: answer, citations },
        ]);
      } else if (!hadError) {
        setError('No answer was received. Please try again.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('The answer took too long. Please try again.');
      } else {
        console.error('[Guest] Request failed:', err.message);
        setError('Could not reach the assistant. Please check your connection and try again.');
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setSending(false);
      setStreamingText('');
      setStatusText('');
      setStreamingCitations([]);
      inputRef.current?.focus();
    }
  }, [history, sending]);

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input);
    }
  };

  const handleFeedback = async (index, vote) => {
    if (feedbackSent[index]) return;
    setFeedbackSent((prev) => ({ ...prev, [index]: vote }));
    try {
      await guestApi.feedback(vote);
    } catch (err) {
      console.error('[Guest] Feedback failed:', err.message);
    }
  };

  const hasApprovedInfo = Boolean(infoStatus?.hasApprovedInfo);
  const lastReviewed = formatDate(infoStatus?.latestLastReviewed);

  return (
    <div className="min-h-screen flex flex-col bg-chalkboard text-chalk">
      <header className="sticky top-0 z-10 border-b border-rule-line bg-chalkboard/95 backdrop-blur">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-chalk flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-pu-cream" />
            </div>
            <div className="min-w-0">
              <p className="font-display font-medium text-lg leading-tight">PU-GPT</p>
              <p className="text-xs text-chalk/60 truncate">About Parul University</p>
            </div>
          </div>
          <Link
            to="/login"
            className="px-3 py-1.5 rounded-lg border border-amber-chalk/40 text-amber-chalk text-sm font-medium hover:bg-amber-chalk/10 transition-colors"
          >
            Log in
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {statusLoading && (
            <div className="flex items-center justify-center py-16 text-chalk/60">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading university information…
            </div>
          )}

          {statusError && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-rust/40 bg-rust/10 text-rust text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{statusError}</span>
            </div>
          )}

          {!statusLoading && !statusError && !hasApprovedInfo && (
            <div className="rounded-xl border border-rule-line bg-pu-panel p-5">
              <h1 className="font-display text-xl mb-2">University information is being prepared</h1>
              <p className="text-sm text-chalk/70 mb-4">
                No approved university information is available yet. Please contact the university directly:
              </p>
              <div className="rounded-lg bg-chalkboard/60 border border-rule-line p-4 text-sm whitespace-pre-line text-chalk/90">
                {infoStatus?.contactBlock}
              </div>
              <p className="text-xs text-chalk/50 mt-4">
                <Link to="/login" className="text-amber-chalk underline">Log in</Link> to ask about your course subjects.
              </p>
            </div>
          )}

          {!statusLoading && !statusError && hasApprovedInfo && messages.length === 0 && !sending && (
            <div className="text-center py-8">
              <h1 className="font-display text-2xl sm:text-3xl mb-2">Ask about Parul University</h1>
              <p className="text-chalk/60 text-sm max-w-lg mx-auto">
                Answers come only from university information approved by Parul University staff.
                {lastReviewed ? ` Last reviewed ${lastReviewed}.` : ''}
              </p>
              {infoStatus?.suggestedChips?.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {infoStatus.suggestedChips.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => sendMessage(chip.message)}
                      className="px-3 py-2 rounded-full border border-amber-chalk/30 bg-amber-chalk/5 text-sm text-chalk/90 hover:bg-amber-chalk/15 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.length > 0 && (
            <div className="space-y-5">
              {messages.map((message, index) => (
                <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-amber-chalk/20 border border-amber-chalk/30 px-4 py-2.5'
                        : 'w-full rounded-2xl rounded-bl-sm bg-pu-panel border border-rule-line px-4 py-3'
                    }
                  >
                    {message.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    ) : (
                      <>
                        <MessageRenderer
                          content={message.content}
                          citations={message.citations || []}
                          sourcesLabel="Sources (University Information)"
                        />
                        <div className="mt-3 pt-2 border-t border-rule-line flex items-center gap-2">
                          <span className="text-xs text-chalk/50">Was this helpful?</span>
                          <button
                            type="button"
                            onClick={() => handleFeedback(index, 'up')}
                            className="p-1.5 rounded hover:bg-chalk/10 text-chalk/60 hover:text-sage transition-colors"
                            aria-label="Helpful"
                          >
                            {feedbackSent[index] === 'up' ? <Check className="w-4 h-4 text-sage" /> : <ThumbsUp className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(index, 'down')}
                            className="p-1.5 rounded hover:bg-chalk/10 text-chalk/60 hover:text-rust transition-colors"
                            aria-label="Not helpful"
                          >
                            {feedbackSent[index] === 'down' ? <Check className="w-4 h-4 text-rust" /> : <ThumbsDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="w-full rounded-2xl rounded-bl-sm bg-pu-panel border border-rule-line px-4 py-3">
                    {streamingText ? (
                      <MessageRenderer
                        content={streamingText}
                        citations={streamingCitations}
                        sourcesLabel="Sources (University Information)"
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-chalk/60">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {statusText || 'Checking approved university information…'}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-lg border border-rust/40 bg-rust/10 text-rust text-sm" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">{error}</div>
              <button type="button" onClick={() => setError('')} className="text-rust/70 hover:text-rust" aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-rule-line bg-chalkboard">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="guest-message" className="sr-only">Ask about Parul University</label>
              <textarea
                id="guest-message"
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder={hasApprovedInfo ? 'Ask about admissions, fees, hostel…' : 'University information is not available yet'}
                disabled={sending || !hasApprovedInfo}
                className="w-full resize-none rounded-xl border border-rule-line bg-pu-panel px-3 py-2.5 text-sm text-chalk placeholder:text-chalk/40 focus:outline-none focus:border-amber-chalk/60 disabled:opacity-60"
              />
              <div className="flex justify-between mt-1 text-[11px] text-chalk/40">
                <span>Chats are not saved.</span>
                <span>{input.length}/{MAX_MESSAGE_CHARS}</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={sending || !input.trim() || !hasApprovedInfo}
              className="mb-5 w-10 h-10 rounded-xl bg-amber-chalk text-pu-cream flex items-center justify-center disabled:opacity-40 hover:brightness-110 transition"
              aria-label="Send question"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          <p className="text-[11px] text-chalk/50 mt-1">
            {infoStatus?.disclaimer}
          </p>
        </div>
      </footer>
    </div>
  );
}
