import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  Info,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Orb } from '@yogesharc/thinking-orbs';
import { guestApi } from '@/utils/api';
import { MessageRenderer } from '@/components/ui/MessageRenderer';

const MAX_MESSAGE_CHARS = 500;
const TYPING_TEXT = 'Ask about Parul University';
const TYPING_PLAIN = 'Ask about ';
const TYPING_ACCENT = 'Parul University';

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

/**
 * Types the heading once on mount. The full text is rendered invisibly first so
 * the block reserves its final size, which keeps the subtitle steady and lets
 * the caret type left-to-right inside a centred heading.
 */
function TypingHeading() {
  const [visible, setVisible] = useState(0);
  const [finished, setFinished] = useState(false);
  const [caretGone, setCaretGone] = useState(false);

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setVisible(TYPING_TEXT.length);
      setFinished(true);
      setCaretGone(true);
      return undefined;
    }

    let index = 0;
    let stepTimer;
    let finishTimer;

    const step = () => {
      index += 1;
      setVisible(index);
      if (index < TYPING_TEXT.length) {
        stepTimer = setTimeout(step, 52);
      } else {
        setFinished(true);
        finishTimer = setTimeout(() => setCaretGone(true), 420);
      }
    };

    const startTimer = setTimeout(step, 260);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(stepTimer);
      clearTimeout(finishTimer);
    };
  }, []);

  const typed = TYPING_TEXT.slice(0, visible);

  return (
    <h1 className="pu-hero-title" aria-label={TYPING_TEXT}>
      <span className="pu-typing-wrap" aria-hidden="true">
        <span className="pu-typing-ghost">
          {TYPING_PLAIN}
          <span className="pu-typing-accent">{TYPING_ACCENT}</span>
        </span>
        <span className="pu-typing-live">
          {typed.slice(0, TYPING_PLAIN.length)}
          <span className="pu-typing-accent">{typed.slice(TYPING_PLAIN.length)}</span>
          {!caretGone && (
            <span className={`pu-typing-caret${finished ? ' is-done' : ''}`} />
          )}
        </span>
      </span>
    </h1>
  );
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
  const threadRef = useRef(null);
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
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: streamingText ? 'auto' : 'smooth',
    });
  }, [messages, streamingText, sending]);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    resizeInput();
  }, [input, resizeInput]);

  // Re-measure once after the first paint so the textarea's initial height is
  // based on the settled layout (fonts + width) instead of the placeholder's
  // pre-layout wrap.
  useEffect(() => {
    const frame = requestAnimationFrame(() => resizeInput());
    return () => cancelAnimationFrame(frame);
  }, [resizeInput]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'PU-GPT — Ask about Parul University';
    return () => {
      document.title = previousTitle;
    };
  }, []);

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
  const chatReady = hasApprovedInfo && !statusLoading && !statusError;
  const contactBlock = infoStatus?.contactBlock || '';

  return (
    <div className="pu-landing">
      <header className="pu-landing-header">
        <Link to="/" className="pu-landing-brand" aria-label="PU-GPT home">
          <span className="pu-landing-brand-mark" aria-hidden="true">
            <BookOpen />
          </span>
          <span className="pu-landing-brand-text">
            <span className="pu-landing-brand-title">PU-GPT</span>
            <span className="pu-landing-brand-sub">About Parul University</span>
          </span>
        </Link>

        <Link to="/login" className="pu-landing-login">
          Log in
        </Link>
      </header>

      <main className="pu-landing-main">
        <section className="pu-landing-hero">
          <span className="pu-chat-orb" aria-hidden="true">
            <Orb state="idle" size={56} speed={0.9} density={1.2} />
          </span>

          <TypingHeading />

          <p className="pu-chat-subtitle">
            Your AI guide for everything about Parul University
          </p>
        </section>

        <section className="pu-conversation" ref={threadRef}>
          <div className="pu-conversation-inner">
            {statusLoading && (
              <div className="pu-chat-status" role="status" aria-live="polite">
                <span className="pu-chat-status-dot" aria-hidden="true" />
                Loading university information…
              </div>
            )}

            {statusError && (
              <div className="pu-chat-alert" role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{statusError}</span>
                <button type="button" className="pu-chat-alert-action" onClick={loadStatus}>
                  <RefreshCw aria-hidden="true" />
                  Retry
                </button>
              </div>
            )}

            {!statusLoading && !statusError && !hasApprovedInfo && (
              <div className="pu-chat-noinfo">
                <span className="pu-chat-noinfo-icon" aria-hidden="true">
                  <Info />
                </span>
                <h2>University information is being prepared</h2>
                <p>
                  No approved university information is available yet. Please contact the
                  university directly:
                </p>
                {contactBlock && <div className="pu-chat-contact">{contactBlock}</div>}
                <p className="pu-chat-noinfo-foot">
                  <Link to="/login">Log in</Link> to ask about your course subjects.
                </p>
              </div>
            )}

            {messages.map((message, index) => (
              <article key={index} className={`pu-chat-msg ${message.role}`}>
                {message.role === 'assistant' && (
                  <span className="pu-chat-avatar" aria-hidden="true">
                    <Sparkles />
                  </span>
                )}
                <div className="pu-chat-msg-body">
                  <div className={`pu-chat-bubble ${message.role}`}>
                    {message.role === 'user' ? (
                      <p className="pu-chat-user-text">{message.content}</p>
                    ) : (
                      <>
                        <MessageRenderer
                          content={message.content}
                          citations={message.citations || []}
                          sourcesLabel="Sources (University Information)"
                        />
                        <div className="pu-chat-feedback">
                          <span>Was this helpful?</span>
                          <button
                            type="button"
                            onClick={() => handleFeedback(index, 'up')}
                            aria-label="Helpful"
                            aria-pressed={feedbackSent[index] === 'up'}
                          >
                            {feedbackSent[index] === 'up' ? (
                              <Check aria-hidden="true" />
                            ) : (
                              <ThumbsUp aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(index, 'down')}
                            aria-label="Not helpful"
                            aria-pressed={feedbackSent[index] === 'down'}
                          >
                            {feedbackSent[index] === 'down' ? (
                              <Check aria-hidden="true" />
                            ) : (
                              <ThumbsDown aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {sending && (
              <article className="pu-chat-msg assistant pu-chat-streaming">
                <span className="pu-chat-avatar" aria-hidden="true">
                  <Sparkles />
                </span>
                <div className="pu-chat-msg-body">
                  <div className="pu-chat-bubble assistant">
                    <div
                      className={`pu-orb-loading${streamingText ? ' is-hiding' : ''}`}
                      role="status"
                      aria-live="polite"
                      aria-hidden={streamingText ? 'true' : undefined}
                    >
                      <Orb
                        state="compacting"
                        size={72}
                        speed={1.2}
                        density={1.5}
                        label="Searching"
                        className="pu-orb-anim"
                      />
                      <span className="pu-orb-label">
                        Searching
                        <span className="pu-orb-dots" aria-hidden="true">
                          <span className="pu-orb-dot">.</span>
                          <span className="pu-orb-dot">.</span>
                          <span className="pu-orb-dot">.</span>
                        </span>
                      </span>
                      {statusText && (
                        <span className="pu-chat-orb-status">{statusText}</span>
                      )}
                    </div>
                    {streamingText && (
                      <MessageRenderer
                        content={streamingText}
                        citations={streamingCitations}
                        sourcesLabel="Sources (University Information)"
                      />
                    )}
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>

        <div className="pu-composer-zone">
          {error && (
            <div className="pu-chat-alert" role="alert">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
              <button
                type="button"
                className="pu-chat-alert-action"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="pu-chat-form">
            <label htmlFor="pu-landing-message" className="sr-only">
              Ask about Parul University
            </label>
            <div className={`pu-chat-input-shell${sending ? ' is-busy' : ''}`}>
              <textarea
                id="pu-landing-message"
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, MAX_MESSAGE_CHARS))}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder={
                  chatReady
                    ? 'Ask about admissions, fees, hostel...'
                    : 'University information is not available yet'
                }
                disabled={sending || !chatReady}
                className="pu-chat-textarea"
                aria-describedby="pu-landing-count"
              />
              <button
                type="submit"
                disabled={sending || !input.trim() || !chatReady}
                className={`pu-chat-send${sending ? ' is-busy' : ''}`}
                aria-label="Send question"
              >
                <ArrowUp aria-hidden="true" />
              </button>
            </div>

            <div className="pu-chat-composer-meta">
              <span
                id="pu-landing-count"
                className={`pu-chat-count${input.length > MAX_MESSAGE_CHARS - 50 ? ' is-near' : ''}`}
              >
                {input.length}/{MAX_MESSAGE_CHARS}
              </span>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
