import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader2, AlertCircle, Check, FileText, Image, X, Edit2, Plus, X as XIcon, RefreshCw, History, Mic, Sparkles, ArrowUp, Paperclip, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { api } from '@/utils/api';
import { MessageRenderer } from '@/components/ui/MessageRenderer';
import { chatApi } from '@/utils/api';
import { ConversationHistoryPanel } from '@/components/ui/ConversationHistoryPanel';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { Orb } from '@yogesharc/thinking-orbs';

// Every conversation (including an unsaved draft) gets its own state bucket.
// A generation writes into its own bucket, so switching chats or starting a new
// one never leaks a response into the conversation that happens to be open.
let draftCounter = 0;
const createDraftKey = () => `draft-${Date.now()}-${++draftCounter}`;

const makeThread = (key, overrides = {}) => ({
  key,
  conversationId: null,
  subject: '',
  messages: [],
  streaming: false,
  currentAnswer: '',
  citations: [],
  status: null,
  error: '',
  permissionPrompt: null,
  pendingQuery: null,
  generatingImage: false,
  generatedImageData: null,
  loadingThread: false,
  loaded: false,
  ...overrides,
});

const EMPTY_THREAD = makeThread('empty');

// Chat attachments use the same limits as the existing picker and backend route.
const CHAT_ALLOWED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const CHAT_FILE_TYPE_ERROR = 'Only PNG, JPEG, WebP images and PDF files are allowed';
const CHAT_FILE_SIZE_ERROR = 'File size exceeds 10MB limit';


// Sanitize query: trim, collapse spaces, block empty
// NOTE: Web search trigger (leading backslash) is now detected by BACKEND
// This function only does basic sanitization, no backslash handling
function sanitizeQuery(query) {
  if (!query) return '';
  let sanitized = query.trim();
  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');
  return sanitized;
}

export function AskPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSubject = searchParams.get('subject');
  const urlConversationId = searchParams.get('conversation');
  const urlIsNewChat = searchParams.get('new') === 'true';
  const [subject, setSubject] = useState(() => urlSubject || '');
  const [question, setQuestion] = useState('');
  const [threads, setThreads] = useState({});
  const [activeKey, setActiveKey] = useState(() => createDraftKey());
  const [subjects, setSubjects] = useState([]);
  // Suggestions come from real course materials for the selected subject.
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Pending file (not yet sent) - shows in chip above input
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingFilePreview, setPendingFilePreview] = useState(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyMessages, setHistoryMessages] = useState([]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const plusMenuRef = useRef(null);
  const dragDepthRef = useRef(0);
  // Track the last subject read from the URL so the sync effect can tell an
  // external (sidebar/drawer) change apart from a composer pick that is still
  // waiting for React Router to commit the new query string.
  const lastUrlSubjectRef = useRef(urlSubject);
  // Guards the one-shot "new chat" reset so it cannot retrigger before the
  // router commits the cleaned URL (React Router 7 navigations are transitions).
  const handledNewChatRef = useRef(false);
  // Live state mirrors used by async stream callbacks (avoids stale closures).
  const activeKeyRef = useRef(activeKey);
  const threadsRef = useRef(threads);
  // One AbortController per thread, so cancelling one chat never stops another.
  const streamsRef = useRef(new Map());
  const loadingConvIdsRef = useRef(new Set());

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const patchThread = useCallback((key, patch) => {
    if (!key) return;
    setThreads((prev) => {
      const base = prev[key] || makeThread(key);
      const value = typeof patch === 'function' ? patch(base) : patch;
      return { ...prev, [key]: { ...base, ...value, key } };
    });
  }, []);

  const activateThread = useCallback((key, nextSubject) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    if (nextSubject !== undefined) setSubject(nextSubject);
  }, []);

  const activeThread = threads[activeKey] || EMPTY_THREAD;
  const {
    messages,
    streaming,
    currentAnswer,
    citations,
    status,
    error,
    permissionPrompt,
    pendingQuery,
    generatingImage,
    generatedImageData,
    conversationId,
  } = activeThread;
  const loading = streaming || activeThread.loadingThread;

  // Cross-browser speech-to-text (MediaRecorder + backend Whisper, with Web Speech fallback)
  const {
    isRecording,
    isTranscribing,
    isBusy,
    error: speechError,
    start: startSpeech,
    stop: stopSpeech,
    toggle: toggleSpeech,
    provider,
  } = useSpeechToText({
    onTranscript: (transcript) => {
      setQuestion((prev) => {
        const separator = prev && !prev.endsWith(' ') ? ' ' : '';
        return `${prev}${separator}${transcript}`.trimStart();
      });
    },
    onError: (msg) => {
      console.error('[Speech] Error:', msg);
    },
    preferredProvider: 'auto', // auto-detects best provider per browser
  });

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [question, resizeTextarea]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Helper to remove pending file - must be defined before loadConversation
  const removePendingFile = useCallback(() => {
    if (pendingFilePreview && pendingFilePreview.startsWith('blob:')) {
      URL.revokeObjectURL(pendingFilePreview);
    }
    setPendingFile(null);
    setPendingFilePreview(null);
    setOcrText('');
    setShowOcrPreview(false);
  }, [pendingFilePreview]);

  // Load a conversation into its own thread bucket. The response only touches
  // that bucket, so a slow load can never overwrite a different chat that the
  // student opened in the meantime.
  const loadConversation = useCallback(async (id) => {
    if (!id) return;
    // A live generation for this id is already the source of truth.
    if (streamsRef.current.has(id)) {
      const live = threadsRef.current[id];
      activateThread(id, live?.subject);
      return;
    }
    const existing = threadsRef.current[id];
    if (existing?.loaded) {
      activateThread(id, existing.subject);
      return;
    }
    if (loadingConvIdsRef.current.has(id)) return;

    loadingConvIdsRef.current.add(id);
    patchThread(id, { loadingThread: true, error: '' });
    activateThread(id, existing?.subject);
    try {
      const res = await chatApi.getConversation(id);
      const conv = res.data.conversation;
      if (!conv) {
        patchThread(id, {
          loadingThread: false,
          loaded: true,
          error: 'Conversation not found',
          messages: [],
          conversationId: null,
        });
        return;
      }
      // Convert messages to frontend format. Attachments come straight from
      // the persisted document, including PDFs restored after a refresh.
      const formattedMessages = (conv.messages || []).map((msg) => ({
        role: msg.role,
        content: msg.content,
        citations: msg.citations || [],
        webSources: msg.webSources || [],
        isWebSearch: msg.isWebSearch || false,
        attachments: msg.attachments || [],
        timestamp: msg.timestamp,
      }));
      patchThread(id, {
        conversationId: conv._id,
        subject: conv.subject || '',
        messages: formattedMessages,
        currentAnswer: '',
        citations: [],
        permissionPrompt: null,
        status: null,
        pendingQuery: null,
        generatingImage: false,
        generatedImageData: null,
        streaming: false,
        error: '',
        loadingThread: false,
        loaded: true,
      });
      if (activeKeyRef.current === id) {
        setSubject(conv.subject || '');
        removePendingFile();
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('subject', conv.subject);
          newParams.set('conversation', conv._id);
          newParams.delete('new');
          return newParams;
        }, { replace: true });
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      patchThread(id, {
        loadingThread: false,
        loaded: true,
        error: 'Failed to load conversation',
        messages: [],
        conversationId: null,
      });
    } finally {
      loadingConvIdsRef.current.delete(id);
    }
  }, [activateThread, patchThread, removePendingFile, setSearchParams]);

  // Fetch subjects
  const fetchSubjects = useCallback(async () => {
    try {
      // Fetch available subjects from teachers
      const res = await api.get('/chat/subjects');
      const availableSubjects = res.data?.subjects || [];

      // Also include student's enrolled subjects (for backward compatibility)
      const userSubjects = user?.subjects || [];
      const combinedSubjects = [...new Set([...availableSubjects, ...userSubjects])];

      setSubjects(combinedSubjects);
      setSubject((prev) => {
        if (prev && combinedSubjects.includes(prev)) return prev;
        if (urlSubject && combinedSubjects.includes(urlSubject)) return urlSubject;
        return combinedSubjects[0] || '';
      });
      // Don't overwrite the subject while opening an existing conversation;
      // the conversation loader sets the subject that belongs to that chat.
      if (
        combinedSubjects[0] &&
        !urlConversationId &&
        (!urlSubject || !combinedSubjects.includes(urlSubject))
      ) {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('subject', combinedSubjects[0]);
          return newParams;
        }, { replace: true });
      }
    } catch (error) {
      console.error('Failed to fetch subjects:', error);
      // Fallback to user's subjects
      const userSubjects = user?.subjects || [];
      setSubjects(userSubjects);
      setSubject((prev) => {
        if (prev && userSubjects.includes(prev)) return prev;
        if (urlSubject && userSubjects.includes(urlSubject)) return urlSubject;
        return userSubjects[0] || '';
      });
      if (
        userSubjects[0] &&
        !urlConversationId &&
        (!urlSubject || !userSubjects.includes(urlSubject))
      ) {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('subject', userSubjects[0]);
          return newParams;
        }, { replace: true });
      }
    }
  }, [user, urlSubject, urlConversationId, setSearchParams]);

  // Authentication and subjects loading. Subjects only need to be fetched
  // once; re-running on every URL subject change used to reset the subject
  // picker while a conversation was loading.
  const subjectsLoadedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (subjectsLoadedRef.current) return;
    subjectsLoadedRef.current = true;
    fetchSubjects();
  }, [isAuthenticated, navigate, fetchSubjects]);

  // Start a fresh draft thread for a new chat. Any thread that is still
  // generating keeps running in the background under its own key.
  const startNewChat = useCallback((nextSubject) => {
    const key = createDraftKey();
    const threadSubject = nextSubject !== undefined ? nextSubject : (urlSubject || subject);
    patchThread(key, { subject: threadSubject, loaded: true });
    activateThread(key, threadSubject);
    setQuestion('');
    removePendingFile();
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('conversation');
      newParams.delete('new');
      if (threadSubject) newParams.set('subject', threadSubject);
      return newParams;
    }, { replace: true });
  }, [activateThread, patchThread, removePendingFile, setSearchParams, subject, urlSubject]);

  // Handle the one-shot ?new=true navigation from the sidebar.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!urlIsNewChat) {
      handledNewChatRef.current = false;
      return;
    }
    if (handledNewChatRef.current) return;
    handledNewChatRef.current = true;
    startNewChat(urlSubject || subject);
  }, [isAuthenticated, urlIsNewChat, urlSubject, subject, startNewChat]);

  // Open the conversation named in the URL. The loader only writes into that
  // conversation's own bucket, so switching mid-load is safe.
  useEffect(() => {
    if (!isAuthenticated || urlIsNewChat || !urlConversationId) return;
    if (urlConversationId === activeKeyRef.current) return;
    loadConversation(urlConversationId);
  }, [isAuthenticated, urlIsNewChat, urlConversationId, loadConversation]);

  // Navigating to /ask without a conversation should show a fresh draft, not
  // silently keep the previous chat on screen.
  useEffect(() => {
    if (!isAuthenticated || urlIsNewChat || urlConversationId) return;
    const current = threadsRef.current[activeKeyRef.current];
    if (!current?.conversationId) return;
    const key = createDraftKey();
    const nextSubject = urlSubject || current.subject || subject;
    patchThread(key, { subject: nextSubject, loaded: true });
    activateThread(key, nextSubject);
    setQuestion('');
    removePendingFile();
  }, [isAuthenticated, urlConversationId, urlIsNewChat, urlSubject, patchThread, activateThread, removePendingFile, subject]);

  // Keep the subject in sync when it is changed from the sidebar / drawer.
  // Never do this while an existing conversation is open: the conversation's
  // own subject is authoritative for that chat.
  useEffect(() => {
    const urlSubjectChanged = lastUrlSubjectRef.current !== urlSubject;
    lastUrlSubjectRef.current = urlSubject;
    if (!isAuthenticated || urlConversationId || urlIsNewChat || !urlSubject) return;
    // Only react to genuine URL changes. A subject picked in the composer also
    // writes the URL, but React Router 7 commits that navigation after the
    // state update; without this guard the stale URL value would revert the
    // pick back to the previous subject.
    if (!urlSubjectChanged) return;
    if (urlSubject === subject) return;

    const key = createDraftKey();
    patchThread(key, { subject: urlSubject, loaded: true });
    activateThread(key, urlSubject);
    setQuestion('');
    removePendingFile();
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('conversation');
      newParams.delete('new');
      return newParams;
    }, { replace: true });
  }, [
    isAuthenticated,
    urlConversationId,
    urlIsNewChat,
    urlSubject,
    subject,
    setSearchParams,
    removePendingFile,
    patchThread,
    activateThread,
  ]);

  // Load suggestions from the course materials that exist for this subject.
  // No hardcoded or random prompts: an empty response renders an empty state.
  useEffect(() => {
    if (!isAuthenticated || !subject) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return undefined;
    }
    let active = true;
    setSuggestionsLoading(true);
    chatApi.suggestions({ subject })
      .then((res) => {
        if (active) setSuggestions(res.data?.suggestions || []);
      })
      .catch((err) => {
        console.error('Failed to load suggestions:', err);
        if (active) setSuggestions([]);
      })
      .finally(() => {
        if (active) setSuggestionsLoading(false);
      });
    return () => { active = false; };
  }, [isAuthenticated, subject]);

  // Scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messages, currentAnswer, streaming, generatingImage]);

  // Cleanup object URLs when messages change or component unmounts
  useEffect(() => {
    return () => {
      messages.forEach((msg) => {
        msg.attachments?.forEach((att) => {
          if (
            att.previewUrl &&
            att.previewUrl.startsWith('blob:')
          ) {
            URL.revokeObjectURL(att.previewUrl);
          }
        });
      });
    };
  }, [messages]);

  const handleSubjectChange = (newSubject) => {
    setPlusMenuOpen(false);
    const key = createDraftKey();
    patchThread(key, { subject: newSubject, loaded: true });
    activateThread(key, newSubject);
    setQuestion('');
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('conversation');
      newParams.delete('new');
      if (newSubject) newParams.set('subject', newSubject);
      return newParams;
    }, { replace: true });
    // Clear pending file when subject changes (resets conversation)
    removePendingFile();
  };

  // Stop only the generation that belongs to this thread. Other chats that are
  // generating in the background keep their own controllers untouched.
  const cancelGeneration = useCallback((key = activeKeyRef.current) => {
    const record = streamsRef.current.get(key);
    if (!record) return;
    record.cancelled = true;
    streamsRef.current.delete(key);
    try {
      record.controller.abort();
    } catch {
      // The request may already be finished; nothing to abort.
    }
    patchThread(key, {
      streaming: false,
      currentAnswer: '',
      status: null,
      generatingImage: false,
      error: '',
    });
  }, [patchThread]);

  const applyFileAttachment = (file) => {
    // Validate against the same types and size the existing picker/backend use.
    if (!CHAT_ALLOWED_FILE_TYPES.includes(file.type)) {
      patchThread(activeKey, { error: CHAT_FILE_TYPE_ERROR });
      return false;
    }

    if (file.size > CHAT_MAX_FILE_SIZE) {
      patchThread(activeKey, { error: CHAT_FILE_SIZE_ERROR });
      return false;
    }

    // The composer holds one attachment, so ignore an exact duplicate drop.
    if (
      pendingFile &&
      pendingFile.name === file.name &&
      pendingFile.type === file.type &&
      pendingFile.size === file.size
    ) {
      patchThread(activeKey, { error: '' });
      return true;
    }

    setPendingFile(file);
    patchThread(activeKey, { error: '' });

    // Create preview for images
    if (file.type.startsWith('image/')) {
      setPendingFilePreview(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        setPendingFilePreview(event.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      // For PDF, no image preview
      setPendingFilePreview(null);
    }

    return true;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) applyFileAttachment(file);

    // Reset file input
    e.target.value = '';
  };

  const isFileDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('Files');

  const handleDragEnter = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (loading || streaming || generatingImage) return;

    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    if (loading || streaming || generatingImage) return;

    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;

    // The existing chat upload accepts one file per message.
    if (files.length > 1) {
      patchThread(activeKey, { error: 'Please attach one file per message.' });
      return;
    }

    if (applyFileAttachment(files[0])) {
      textareaRef.current?.focus();
    }
  };

  const getFileIcon = (mimeType) => {
    if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-rust" />;
    if (mimeType.startsWith('image/')) return <Image className="w-5 h-5 text-sage" />;
    return <FileText className="w-5 h-5 text-chalk/50" />;
  };

  const getFileTypeLabel = (mimeType) => {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType === 'image/png') return 'PNG';
    if (mimeType === 'image/jpeg') return 'JPG';
    if (mimeType === 'image/webp') return 'WebP';
    return 'FILE';
  };

  const useOcrText = () => {
    setQuestion(ocrText);
    setShowOcrPreview(false);
    setOcrText('');
    textareaRef.current?.focus();
  };

  const editOcrText = () => {
    setQuestion(ocrText);
    setShowOcrPreview(false);
    textareaRef.current?.focus();
  };

  const discardOcrText = () => {
    setShowOcrPreview(false);
    setOcrText('');
  };

  // Consume an SSE response for one thread. Every write is addressed to that
  // thread's key, so a background answer can finish while another chat is open
  // without leaking into it.
  const processSseStream = useCallback(async (res, initialKey, record, { rawQuestion = '', isWebSearch = false } = {}) => {
    let streamKey = initialKey;
    let fullAnswer = '';
    let finalCitations = [];
    let finalImage = null;
    let sawPermission = false;
    let sawError = false;
    let buffer = '';
    let eventCount = 0;

    const adoptConversationId = (id) => {
      if (!id || record.cancelled) return;
      if (id === streamKey) {
        patchThread(id, { conversationId: id });
        return;
      }
      const previousKey = streamKey;
      setThreads((prev) => {
        const source = prev[previousKey] || makeThread(previousKey);
        const target = prev[id];
        const next = { ...prev };
        delete next[previousKey];
        next[id] = target
          ? { ...target, ...source, key: id, conversationId: id, subject: source.subject || target.subject }
          : { ...source, key: id, conversationId: id };
        return next;
      });
      const live = streamsRef.current.get(previousKey);
      if (live) {
        streamsRef.current.delete(previousKey);
        streamsRef.current.set(id, live);
      }
      streamKey = id;
      if (activeKeyRef.current === previousKey) {
        activeKeyRef.current = id;
        setActiveKey(id);
        setSearchParams((prev) => {
          const params = new URLSearchParams(prev);
          params.set('conversation', id);
          params.delete('new');
          return params;
        }, { replace: true });
      }
      // The conversation now exists in the database (with the user's first
      // message), so the sidebar can refresh immediately.
      window.dispatchEvent(new Event('pu:history-updated'));
    };

    const handleEvent = (parsed) => {
      if (record.cancelled) return;
      switch (parsed.type) {
        case 'content':
          if (parsed.content) {
            patchThread(streamKey, (thread) => ({
              ...thread,
              currentAnswer: thread.currentAnswer + parsed.content,
            }));
          }
          break;
        case 'status':
          patchThread(streamKey, { status: { status: parsed.status, stage: parsed.stage } });
          break;
        case 'citations':
          finalCitations = parsed.citations || [];
          patchThread(streamKey, { citations: finalCitations });
          break;
        case 'conversationId':
          adoptConversationId(parsed.id);
          break;
        case 'ocr_text':
          if (parsed.text) {
            setOcrText(parsed.text);
            setShowOcrPreview(true);
          }
          break;
        case 'image_pending':
          patchThread(streamKey, { generatingImage: true });
          break;
        case 'image_ready':
          if (parsed.image) {
            finalImage = parsed.image;
            patchThread(streamKey, { generatedImageData: parsed.image, generatingImage: false });
          }
          break;
        case 'error':
          sawError = true;
          console.error('[Chat] SSE error event:', parsed);
          patchThread(streamKey, { error: parsed.message || parsed.error || 'An error occurred' });
          break;
        case 'permission':
          sawPermission = true;
          if (parsed.permissionPrompt) {
            patchThread(streamKey, {
              permissionPrompt: parsed.permissionPrompt,
              streaming: false,
              status: null,
            });
          }
          break;
        default:
          // Handle legacy events (status/content without an explicit type).
          if (parsed.status) {
            patchThread(streamKey, { status: { status: parsed.status, stage: parsed.stage } });
          } else if (parsed.content) {
            patchThread(streamKey, (thread) => ({
              ...thread,
              currentAnswer: thread.currentAnswer + parsed.content,
            }));
          } else if (parsed.needsPermission && parsed.permissionPrompt) {
            sawPermission = true;
            patchThread(streamKey, { permissionPrompt: parsed.permissionPrompt, streaming: false });
          }
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        if (record.cancelled) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const data = trimmedLine.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            eventCount += 1;
            handleEvent(parsed);
            if (parsed.type === 'content' && parsed.content) {
              fullAnswer += parsed.content;
            }
          } catch (parseErr) {
            console.warn('[Chat] Failed to parse SSE data:', data, parseErr);
            fullAnswer += data;
            if (!record.cancelled) {
              patchThread(streamKey, { currentAnswer: fullAnswer });
            }
          }
        }
      }

      if (buffer && !record.cancelled) {
        const trimmedBuffer = buffer.trim();
        if (trimmedBuffer.startsWith('data: ')) {
          const data = trimmedBuffer.slice(6).trim();
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              handleEvent(parsed);
              if (parsed.type === 'content' && parsed.content) {
                fullAnswer += parsed.content;
              }
            } catch {
              fullAnswer += buffer;
              patchThread(streamKey, { currentAnswer: fullAnswer });
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader already released.
      }
    }

    if (record.cancelled) return;

    if (fullAnswer.trim() || finalImage) {
      const assistantMessage = {
        role: 'assistant',
        content: fullAnswer || '[Generated Image]',
        citations: finalCitations,
        webSources: [],
        isWebSearch: Boolean(isWebSearch || rawQuestion.startsWith('\\') || rawQuestion.startsWith('＼')),
        attachments: finalImage
          ? [{
            type: 'generated_image',
            url: finalImage.dataUrl,
            mimeType: finalImage.mimeType,
            width: finalImage.width,
            height: finalImage.height,
            prompt: finalImage.prompt,
          }]
          : [],
        timestamp: new Date().toISOString(),
      };
      patchThread(streamKey, (thread) => ({
        ...thread,
        messages: [...thread.messages, assistantMessage],
        streaming: false,
        currentAnswer: '',
        status: null,
        citations: finalCitations,
        generatingImage: false,
        generatedImageData: null,
        pendingQuery: null,
      }));
      window.dispatchEvent(new Event('pu:history-updated'));
    } else if (sawPermission) {
      patchThread(streamKey, {
        streaming: false,
        currentAnswer: '',
        status: null,
        generatingImage: false,
      });
    } else if (!sawError) {
      patchThread(streamKey, (thread) => ({
        ...thread,
        streaming: false,
        currentAnswer: '',
        status: null,
        generatingImage: false,
        pendingQuery: null,
        error: thread.error || 'No answer received, please try again.',
      }));
    } else {
      patchThread(streamKey, {
        streaming: false,
        currentAnswer: '',
        status: null,
        generatingImage: false,
        pendingQuery: null,
      });
    }

    console.log('[Chat] SSE stream finished, events:', eventCount, 'answer length:', fullAnswer.length);
  }, [patchThread, setSearchParams]);

  const handleAsk = async (e, overrideQuestion) => {
    if (e?.preventDefault) e.preventDefault();
    const rawQuestion = (overrideQuestion ?? question).trim();
    // Allow sending with just a file (no question text)
    if (!rawQuestion && !pendingFile) return;
    if (!subject) return;

    // One generation per thread at a time.
    const threadKey = activeKeyRef.current;
    if (streamsRef.current.has(threadKey)) return;

    const controller = new AbortController();
    const record = { controller, cancelled: false, timedOut: false };
    streamsRef.current.set(threadKey, record);

    const conversationForSend = conversationId;

    patchThread(threadKey, {
      subject,
      streaming: true,
      currentAnswer: '',
      citations: [],
      status: null,
      error: '',
      permissionPrompt: null,
      pendingQuery: rawQuestion,
      generatingImage: false,
      generatedImageData: null,
      loaded: true,
    });

    // Build attachment object for the user message (includes previewUrl for rendering)
    const attachment = pendingFile ? {
      name: pendingFile.name,
      type: pendingFile.type,
      size: pendingFile.size,
      previewUrl: pendingFilePreview, // For rendering thumbnail in message
    } : null;

    const userMessageContent = rawQuestion || (pendingFile ? '[File]' : '');
    const userMessage = {
      role: 'user',
      content: userMessageContent,
      citations: [],
      attachments: attachment ? [attachment] : [],
      timestamp: new Date().toISOString(),
    };
    // The question appears immediately, before the answer, and is never
    // appended again when the response arrives. If the last turn is the same
    // unanswered question (retry after cancel/error), reuse it instead of
    // showing a duplicate.
    patchThread(threadKey, (thread) => {
      const last = thread.messages[thread.messages.length - 1];
      const isRetryOfLastUserTurn = !pendingFile
        && last?.role === 'user'
        && last.content === userMessageContent;
      return {
        ...thread,
        messages: isRetryOfLastUserTurn ? thread.messages : [...thread.messages, userMessage],
      };
    });

    // Clear pending file (moves it into the message above)
    const fileToSend = pendingFile;
    setPendingFile(null);
    setPendingFilePreview(null);
    setQuestion('');
    setOcrText('');
    setShowOcrPreview(false);

    const timeoutId = setTimeout(() => {
      record.timedOut = true;
      controller.abort();
    }, 240000); // 240s for slow vision responses

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        patchThread(threadKey, {
          streaming: false,
          error: 'Please log in to ask questions',
        });
        return;
      }

      const res = await chatApi.ask({
        question: rawQuestion,
        subject,
        conversationId: conversationForSend,
        file: fileToSend,
      }, controller.signal);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Chat] Server error:', res.status, errorText);
        if (!record.cancelled) {
          patchThread(threadKey, {
            streaming: false,
            error: `Server error: ${res.status} - ${errorText}`,
          });
        }
        return;
      }

      await processSseStream(res, threadKey, record, { rawQuestion });
    } catch (err) {
      if (record.cancelled) return;
      if (err.name === 'AbortError') {
        patchThread(threadKey, {
          streaming: false,
          currentAnswer: '',
          status: null,
          generatingImage: false,
          error: record.timedOut ? 'Request timed out. Please try again.' : '',
        });
      } else {
        console.error('Chat error:', err);
        patchThread(threadKey, {
          streaming: false,
          currentAnswer: '',
          status: null,
          generatingImage: false,
          error: 'Failed to get answer. Please try again.',
        });
      }
    } finally {
      clearTimeout(timeoutId);
      streamsRef.current.delete(threadKey);
    }
  };
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const form = e.target.closest('form');
      if (form) {
        form.requestSubmit();
      }
    }
  };

  const handlePermissionResponse = async (confirmed) => {
    if (!permissionPrompt) return;

    const threadKey = activeKeyRef.current;
    const userMessage = {
      role: 'user',
      content: confirmed ? 'Yes, search the web' : "No, I'll rephrase my question",
      citations: [],
      attachments: [],
      timestamp: new Date().toISOString(),
    };
    patchThread(threadKey, (thread) => ({
      ...thread,
      messages: [...thread.messages, userMessage],
    }));

    if (!confirmed) {
      patchThread(threadKey, { permissionPrompt: null, pendingQuery: null });
      // Focus input for rephrasing
      textareaRef.current?.focus();
      return;
    }

    if (streamsRef.current.has(threadKey)) return;

    const thread = threadsRef.current[threadKey];
    const conversationForSend = thread?.conversationId || conversationId;
    const questionForSearch = thread?.pendingQuery || pendingQuery;

    const controller = new AbortController();
    const record = { controller, cancelled: false, timedOut: false };
    streamsRef.current.set(threadKey, record);

    patchThread(threadKey, {
      streaming: true,
      currentAnswer: '',
      permissionPrompt: null,
      error: '',
      status: { status: 'Searching the web...', stage: 'webSearch' },
    });

    const timeoutId = setTimeout(() => {
      record.timedOut = true;
      controller.abort();
    }, 240000); // 240s timeout

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/chat/confirm-web-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: questionForSearch, subject, conversationId: conversationForSend }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Chat] Web search server error:', res.status, errorText);
        if (!record.cancelled) {
          patchThread(threadKey, {
            streaming: false,
            error: `Server error: ${res.status} - ${errorText}`,
          });
        }
        return;
      }

      await processSseStream(res, threadKey, record, {
        rawQuestion: questionForSearch,
        isWebSearch: true,
      });
    } catch (err) {
      if (record.cancelled) return;
      if (err.name === 'AbortError') {
        patchThread(threadKey, {
          streaming: false,
          currentAnswer: '',
          status: null,
          error: record.timedOut ? 'Web search timed out. Please try again.' : '',
        });
      } else {
        console.error('Web search confirmation error:', err);
        patchThread(threadKey, {
          streaming: false,
          currentAnswer: '',
          status: null,
          error: 'Failed to search the web. Please try again.',
        });
      }
    } finally {
      clearTimeout(timeoutId);
      streamsRef.current.delete(threadKey);
      patchThread(threadKey, { pendingQuery: null });
    }
  };

  const getStatusText = () => {
    if (!status) return null;
    const statusTexts = {
      retrieval: 'Reading your course material...',
      generation: 'Thinking...',
      webSearch: 'Searching the web...',
      webGeneration: 'Reviewing sources...',
      ocr: 'Extracting text from image...',
      imageGen: 'Generating image...',
    };
    return statusTexts[status.stage] || status.status || 'Processing...';
  };

  const hasThread =
    messages.length > 0 ||
    streaming ||
    !!currentAnswer ||
    !!permissionPrompt ||
    generatingImage ||
    showOcrPreview;
  const emptyState = !hasThread;

  const applySuggestion = (prompt) => {
    setQuestion(prompt);
    textareaRef.current?.focus();
  };

  return (
    <div className={`pu-ask-page ${hasThread ? 'has-thread' : 'is-empty'}`}>
      {hasThread && (
        <div className="pu-thread-wrap">
          <div className="pu-thread">
            <div className="pu-thread-toolbar">
              <span className="pu-thread-subject">
                {subject || 'Curriculum Assistant'}
              </span>
              {conversationId && (
                <button
                  type="button"
                  className="pu-thread-history"
                  onClick={() => setShowHistoryPanel((value) => !value)}
                  aria-label="Toggle conversation history"
                >
                  <History className="h-3.5 w-3.5" />
                  History
                </button>
              )}
            </div>

            {messages.map((msg, index) => (
              <div
                key={index}
                className={`pu-msg ${msg.role}`}
                data-message-role={msg.role}
                data-message-index={index}
              >
                <div className={`pu-msg-avatar ${msg.role === 'assistant' ? 'assistant' : ''}`}>
                  {msg.role === 'user' ? (
                    user?.name?.charAt(0)?.toUpperCase() || 'U'
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </div>
                <div className="pu-msg-body">
                  <div className="pu-msg-meta">
                    <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {msg.isWebSearch && <span className="pu-web-badge">Web</span>}
                  </div>
                  <div className="pu-msg-bubble">
                    <MessageRenderer
                      content={msg.content}
                      citations={msg.citations || []}
                      webSources={msg.webSources || []}
                      isWebSearch={msg.isWebSearch}
                      attachments={msg.attachments || []}
                    />
                  </div>
                </div>
              </div>
            ))}

            {permissionPrompt && (
              <div className="pu-msg assistant" key="permission-prompt">
                <div className="pu-msg-avatar assistant">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="pu-msg-body">
                  <div className="pu-msg-meta">
                    <span>Assistant</span>
                    <span className="pu-web-badge">Web</span>
                  </div>
                  <div className="pu-permission">
                    <p className="text-sm leading-relaxed">{permissionPrompt.message}</p>
                    <div className="pu-permission-actions">
                      <button
                        type="button"
                        className="pu-btn-primary"
                        onClick={() => handlePermissionResponse(true)}
                      >
                        Yes, search the web
                      </button>
                      <button
                        type="button"
                        className="pu-btn-secondary"
                        onClick={() => handlePermissionResponse(false)}
                      >
                        No, I&apos;ll rephrase
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {streaming && (
              <div
                className="pu-msg assistant"
                data-message-role="assistant"
                data-message-streaming="true"
              >
                <div className="pu-msg-avatar assistant">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="pu-msg-body">
                  <div className="pu-msg-meta">
                    <span>Assistant</span>
                    {status && status.stage !== 'generation' && (
                      <span className="pu-status">{getStatusText()}</span>
                    )}
                  </div>
                  <div className="pu-msg-bubble">
                    {streaming && (
                      <div
                        className={`pu-orb-loading${currentAnswer ? ' is-hiding' : ''}`}
                        role="status"
                        aria-live="polite"
                        aria-hidden={currentAnswer ? 'true' : undefined}
                      >
                        <Orb
                          state="compacting"
                          size={100}
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
                      </div>
                    )}
                    {currentAnswer && (
                      <div className="whitespace-pre-wrap">
                        {currentAnswer}
                        <span className="pu-stream-caret" />
                      </div>
                    )}
                    {generatingImage && (
                      <div className="mt-3 flex items-center gap-2 text-sm opacity-80">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating image...
                      </div>
                    )}
                    {generatedImageData && (
                      <img
                        src={generatedImageData.dataUrl}
                        alt={`Generated: ${generatedImageData.prompt}`}
                        className="pu-generated-image"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      <div className={`pu-composer-zone ${hasThread ? 'docked' : 'empty'}`}>
        <div className="pu-composer-wrap">
          {error && (
            <div className="pu-alert" role="alert">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                className="pu-btn-secondary"
                onClick={() => {
                  const lastUser = [...messages].reverse().find((msg) => msg.role === 'user');
                  patchThread(activeKey, { error: '' });
                  if (lastUser) {
                    handleAsk(new Event('submit', { cancelable: true }), lastUser.content);
                  }
                }}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Retry
              </button>
            </div>
          )}

          {showOcrPreview && ocrText && (
            <div className="pu-ocr animate-in">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Image className="h-4 w-4" />
                  Extracted text
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="pu-btn-primary" onClick={useOcrText}>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Use text
                  </button>
                  <button type="button" className="pu-btn-secondary" onClick={editOcrText}>
                    <Edit2 className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button type="button" className="pu-btn-secondary" onClick={discardOcrText}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    Discard
                  </button>
                </div>
              </div>
              <textarea
                value={ocrText}
                onChange={(event) => setOcrText(event.target.value)}
                className="pu-ocr-textarea"
                rows={4}
                placeholder="OCR result - you can edit before using..."
              />
              <p className="mt-2 text-right text-[11px] opacity-55">
                Review and correct any OCR errors before sending
              </p>
            </div>
          )}

          {pendingFile && (
            <div className="pu-pending-file animate-in">
              <div className="pu-pending-thumb">
                {pendingFilePreview ? (
                  <img src={pendingFilePreview} alt={pendingFile?.name} />
                ) : (
                  <div className="flex flex-col items-center justify-center">
                    {getFileIcon(pendingFile?.type)}
                    <span className="mt-1 text-[10px] opacity-60">PDF</span>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="pu-pending-name">{pendingFile?.name}</p>
                <p className="pu-pending-size">
                  {getFileTypeLabel(pendingFile?.type)} · {(pendingFile?.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={removePendingFile}
                className="pu-icon-btn"
                aria-label="Remove file"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          <form onSubmit={handleAsk} className="pu-composer-form" noValidate>
            <div
              className={`pu-composer ${isDraggingFile ? 'is-drag-over' : ''}`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="pu-plus-wrap" ref={plusMenuRef}>
                <button
                  type="button"
                  onClick={() => setPlusMenuOpen((value) => !value)}
                  className="pu-plus-btn"
                  aria-label="Add attachment or change subject"
                  aria-expanded={plusMenuOpen}
                >
                  <Plus />
                </button>

                {plusMenuOpen && (
                  <div className="pu-plus-menu">
                    <button
                      type="button"
                      className="pu-plus-menu-item"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <Paperclip className="h-4 w-4 flex-shrink-0" />
                      Attach image or PDF
                    </button>

                    {subjects.length > 0 && (
                      <div className="pu-plus-menu-label">Subject</div>
                    )}
                    {subjects.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={`pu-plus-menu-item ${item === subject ? 'active' : ''}`}
                        onClick={() => handleSubjectChange(item)}
                      >
                        <span className="flex-1 truncate text-left">{item}</span>
                        {item === subject && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="pu-input-wrap">
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={hasThread ? 'Ask a follow-up…' : 'Ask anything'}
                  className="pu-input"
                  rows={1}
                  disabled={loading || streaming || generatingImage}
                  aria-label="Your question"
                />
              </div>

              {streaming ? (
                <button
                  type="button"
                  className="pu-mic-btn"
                  onClick={() => cancelGeneration(activeKey)}
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <Square />
                </button>
              ) : question.trim() || pendingFile ? (
                <button
                  type="submit"
                  className="pu-mic-btn"
                  disabled={
                    (!question.trim() && !pendingFile) ||
                    !subject ||
                    loading ||
                    generatingImage
                  }
                  aria-label="Send message"
                >
                  {generatingImage ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUp />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className={`pu-mic-btn ${isBusy ? 'is-listening' : ''}`}
                  onClick={toggleSpeech}
                  aria-label={isBusy ? 'Stop voice input' : 'Start voice input'}
                  disabled={isTranscribing}
                >
                  {isRecording ? (
                    <Loader2 className="animate-spin" />
                  ) : isTranscribing ? (
                    <span className="pu-mic-icon">
                      <Loader2 className="animate-spin" style={{width:22,height:22}} />
                    </span>
                  ) : (
                    <span className="pu-mic-icon">
                      <Mic />
                      <Sparkles className="pu-mic-sparkle" />
                    </span>
                  )}
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />

            {emptyState && (
              <div className="pu-suggestions">
                {suggestionsLoading ? (
                  <div className="pu-sugg-loading">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading suggestions…
                  </div>
                ) : suggestions.length > 0 ? (
                  <div className="pu-sugg-row pu-sugg-row-1">
                    {suggestions.slice(0, 4).map((suggestion) => (
                      <button
                        key={suggestion.prompt}
                        type="button"
                        className="pu-sugg"
                        title={suggestion.prompt}
                        onClick={() => applySuggestion(suggestion.prompt)}
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="pu-sugg-empty">
                    No suggested questions for this subject yet.
                  </p>
                )}
              </div>
            )}
          </form>
        </div>
      </div>

      {showHistoryPanel && conversationId && (
        <ConversationHistoryPanel
          conversationId={conversationId}
          subject={subject}
          onLoadMessages={setHistoryMessages}
          onClose={() => setShowHistoryPanel(false)}
        />
      )}
    </div>
  );
}