import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader2, AlertCircle, Check, FileText, Image, X, Edit2, Plus, X as XIcon, RefreshCw, History, Mic, Sparkles, ArrowUp, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { api } from '@/utils/api';
import { MessageRenderer } from '@/components/ui/MessageRenderer';
import { chatApi } from '@/utils/api';
import { ConversationHistoryPanel } from '@/components/ui/ConversationHistoryPanel';
import { useSpeechToText } from '@/hooks/useSpeechToText';

const SUGGESTION_LABELS = {
  'Computer Science': [
    'Explain quicksort',
    'Stack vs queue',
    'Big-O notation',
    'Java garbage collection',
    'Recurrence relation',
  ],
  Mathematics: [
    'Prove √2 is irrational',
    'Fundamental theorem',
    'Differential equations',
    'Calculus basics',
    'Practice integral',
  ],
  Physics: [
    'Equations of motion',
    'Photoelectric effect',
    'Quantum entanglement',
    'Newton’s laws',
    'Practice problem',
  ],
  Chemistry: [
    'Balance an equation',
    'Le Chatelier’s principle',
    'Hybridization',
    'Periodic trends',
    'Practice problem',
  ],
  Algorithms: [
    'Explain quicksort',
    'Big-O notation',
    'Graph traversal',
    'Dynamic programming',
    'Practice problem',
  ],
  default: [
    'Explain a concept',
    'Give an example',
    'Key definitions',
    'Summarize the unit',
    'Practice problem',
  ],
};

const EXAMPLE_PROMPTS = {
  'Computer Science': [
    'What is the time complexity of quicksort?',
    'Explain the difference between stack and queue',
    'How does garbage collection work in Java?',
  ],
  'Mathematics': [
    'Prove that the square root of 2 is irrational',
    'What is the fundamental theorem of calculus?',
    'Solve the differential equation dy/dx = y',
  ],
  'Physics': [
    'Derive the equations of motion for constant acceleration',
    'What is the photoelectric effect?',
    'Explain quantum entanglement',
  ],
  'Chemistry': [
    'Balance the chemical equation for combustion of methane',
    'What is Le Chatelier\'s principle?',
    'Explain hybridization in methane',
  ],
  'default': [
    'What are the key concepts in this subject?',
    'Summarize the main topics covered this semester',
    'Give me an example problem from this unit',
    'How should I prepare for the exam?',
    'Show me a worked example',
  ],
};

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
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [citations, setCitations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [permissionPrompt, setPermissionPrompt] = useState(null);
  const [status, setStatus] = useState(null);
  const [pendingQuery, setPendingQuery] = useState(null);
  // Pending file (not yet sent) - shows in chip above input
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingFilePreview, setPendingFilePreview] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImageData, setGeneratedImageData] = useState(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyMessages, setHistoryMessages] = useState([]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const plusMenuRef = useRef(null);
  // Track the last loaded conversation ID to prevent duplicate loads
  const lastLoadedConvIdRef = useRef(null);
  // Track if we're mid-stream and already have a conversationId from the backend
  // This prevents the URL effect from clearing/loading the just-created conversation.
  const sseConversationIdRef = useRef(null);
  // Guards the one-shot "new chat" reset so it cannot retrigger before the
  // router commits the cleaned URL (React Router 7 navigations are transitions).
  const handledNewChatRef = useRef(false);

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

  // Load conversation from URL parameter
  const loadConversation = useCallback(async (id) => {
    if (!id) return;
    // Prevent duplicate loads for the same conversation
    if (lastLoadedConvIdRef.current === id) {
      return;
    }
    lastLoadedConvIdRef.current = id;
    try {
      setLoading(true);
      setError('');
      const res = await chatApi.getConversation(id);
      const conv = res.data.conversation;
      if (conv) {
        setConversationId(conv._id);
        setSubject(conv.subject);
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('subject', conv.subject);
          newParams.set('conversation', conv._id);
          return newParams;
        }, { replace: true });
        // Convert messages to frontend format
        const formattedMessages = (conv.messages || []).map(msg => ({
          role: msg.role,
          content: msg.content,
          citations: msg.citations || [],
          webSources: msg.webSources || [],
          isWebSearch: msg.isWebSearch || false,
          attachments: msg.attachments || [],
          timestamp: msg.timestamp,
        }));
        setMessages(formattedMessages);
        setCurrentAnswer('');
        setCitations([]);
        setPermissionPrompt(null);
        setStatus(null);
        setPendingQuery(null);
        removePendingFile();
      } else {
        setError('Conversation not found');
        setMessages([]);
        setConversationId(null);
        lastLoadedConvIdRef.current = null;
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setError('Failed to load conversation');
      setMessages([]);
      setConversationId(null);
      lastLoadedConvIdRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [removePendingFile, setSearchParams]);

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

  // Handle URL parameters (new chat, conversation ID)
  useEffect(() => {
    if (!isAuthenticated) return;

    // Check for new chat parameter
    if (urlIsNewChat) {
      // React Router 7 commits navigations inside a transition, so this effect
      // can re-run with a stale `?new=true` search before the URL updates.
      // Without this guard the reset + navigate pair loops forever
      // ("Maximum update depth exceeded").
      if (handledNewChatRef.current) return;
      handledNewChatRef.current = true;

      // Clear the new parameter from URL
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('new');
      setSearchParams(nextParams, { replace: true });

      // Reset conversation state for new chat
      setConversationId(null);
      setMessages([]);
      setCurrentAnswer('');
      setCitations([]);
      setError('');
      setPermissionPrompt(null);
      setStatus(null);
      setPendingQuery(null);
      removePendingFile();
      sseConversationIdRef.current = null;
      // Allow the same conversation to be opened again after starting a new chat.
      lastLoadedConvIdRef.current = null;
      return;
    }

    handledNewChatRef.current = false;

    // If we just received a conversationId from SSE, don't reload it from URL.
    // The SSE event is the authoritative source for newly created conversations.
    if (sseConversationIdRef.current && urlConversationId === sseConversationIdRef.current) {
      return;
    }

    // Check for conversation ID in URL
    if (urlConversationId) {
      loadConversation(urlConversationId);
    } else if (!urlConversationId && conversationId) {
      // URL no longer has conversation param but we have one in state - clear it
      setConversationId(null);
      setMessages([]);
      setCurrentAnswer('');
      setCitations([]);
      setPermissionPrompt(null);
      setStatus(null);
      setPendingQuery(null);
      removePendingFile();
      lastLoadedConvIdRef.current = null;
    }
  }, [
    isAuthenticated,
    urlConversationId,
    urlIsNewChat,
    searchParams,
    setSearchParams,
    loadConversation,
    conversationId,
    removePendingFile,
  ]);

  // Keep the subject in sync when it is changed from the sidebar / drawer.
  // Never do this while an existing conversation is open: the conversation's
  // own subject is authoritative for that chat.
  useEffect(() => {
    if (!isAuthenticated || urlConversationId || !urlSubject || urlSubject === subject) return;

    setSubject(urlSubject);
    setMessages([]);
    setConversationId(null);
    setCurrentAnswer('');
    setCitations([]);
    setPermissionPrompt(null);
    setStatus(null);
    setPendingQuery(null);
    setError('');
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
    urlSubject,
    subject,
    setSearchParams,
    removePendingFile,
  ]);

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
    setSubject(newSubject);
    setMessages([]);
    setConversationId(null);
    setCurrentAnswer('');
    setCitations([]);
    setPermissionPrompt(null);
    setStatus(null);
    setPendingQuery(null);
    setPlusMenuOpen(false);
    // Keep the selected subject in the URL so the sidebar stays in sync.
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('conversation');
      newParams.delete('new');
      if (newSubject) newParams.set('subject', newSubject);
      return newParams;
    }, { replace: true });
    // Clear pending file when subject changes (resets conversation)
    removePendingFile();
  };

  const getExamplePrompts = () => {
    return EXAMPLE_PROMPTS[subject] || EXAMPLE_PROMPTS.default;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only PNG, JPEG, WebP images and PDF files are allowed');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size exceeds 10MB limit');
      return;
    }

    setPendingFile(file);
    setError('');

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPendingFilePreview(event.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      // For PDF, no image preview
      setPendingFilePreview(null);
    }

    // Reset file input
    e.target.value = '';
  };

  const getFileIcon = (mimeType) => {
    if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-rust" />;
    if (mimeType.startsWith('image/')) return <Image className="w-5 h-5 text-sage" />;
    return <FileText className="w-5 h-5 text-chalk/50" />;
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

  const handleAsk = async (e) => {
    e.preventDefault();
    const rawQuestion = question.trim();
    // Allow sending with just a file (no question text)
    if (!rawQuestion && !pendingFile) return;
    if (!subject) return;

    // Backend will detect web search trigger and sanitize
    // Frontend sends raw question as-is
    console.log('[Chat] Raw question:', rawQuestion, 'hasFile:', !!pendingFile);

    // Keep original query for potential web search retry
    setPendingQuery(rawQuestion);

    setLoading(true);
    setError('');
    setStreaming(true);
    setCurrentAnswer('');
    setPermissionPrompt(null);
    setGeneratingImage(false);
    setGeneratedImageData(null);

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
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    // Clear pending file (moves it into the message above)
    const fileToSend = pendingFile;
    setPendingFile(null);
    setPendingFilePreview(null);
    setQuestion('');

    // AbortController for timeout and cleanup - 240s for slow vision responses
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 240000); // 240s timeout

    try {
      const token = localStorage.getItem('token');

      if (!token) {
        setError('Please log in to ask questions');
        setStreaming(false);
        setLoading(false);
        return;
      }

      // Use the new chatApi.ask with FormData - NO isWebSearch flag, backend detects it
      const res = await chatApi.ask({
        question: rawQuestion,
        subject,
        conversationId,
        file: fileToSend,
      }, controller.signal);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Chat] Server error:', res.status, errorText);
        setError(`Server error: ${res.status} - ${errorText}`);
        setStreaming(false);
        setLoading(false);
        return;
      }

      console.log('[Chat] SSE stream started, content-type:', res.headers.get('content-type'));

      // Process SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';
      let buffer = '';
      let eventCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue; // ignore empty lines
          
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6).trim();
            if (data === '[DONE]') {
              console.log('[Chat] Received [DONE] event');
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              eventCount++;
              console.log(`[Chat] SSE event #${eventCount}:`, parsed.type, parsed.status || parsed.content ? 'content' : '');
              handleStreamEvent(parsed);
              // Accumulate content for final message
              if (parsed.type === 'content' && parsed.content) {
                fullAnswer += parsed.content;
              }
            } catch (parseErr) {
              console.warn('[Chat] Failed to parse SSE data:', data, parseErr);
              // Handle plain text chunks (fallback)
              fullAnswer += data;
              setCurrentAnswer(fullAnswer);
            }
          }
        }
      }

      if (buffer) {
        try {
          const trimmedBuffer = buffer.trim();
          if (trimmedBuffer.startsWith('data: ')) {
            const data = trimmedBuffer.slice(6).trim();
            if (data !== '[DONE]') {
              const parsed = JSON.parse(data);
              handleStreamEvent(parsed);
              if (parsed.type === 'content' && parsed.content) {
                fullAnswer += parsed.content;
              }
            }
          }
        } catch {
          fullAnswer += buffer;
          setCurrentAnswer(fullAnswer);
        }
      }

      // Only add assistant message for streaming responses with actual content
      if (fullAnswer.trim() || generatedImageData) {
        const assistantMessage = {
          role: 'assistant',
          content: fullAnswer || (generatedImageData ? '[Generated Image]' : ''),
          citations,
          webSources: [],
         isWebSearch: rawQuestion.startsWith('\\'),  // Set based on whether it was a web search
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else if (!permissionPrompt && !error) {
        // Stream finished but no answer received
        setError('No answer received, please try again.');
      }
      setStreaming(false);

    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Please try again.');
      } else {
        console.error('Chat error:', err);
        setError('Failed to get answer. Please try again.');
      }
      setStreaming(false);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleStreamEvent = (parsed) => {
    console.log('[Chat] handleStreamEvent:', parsed.type, parsed.status || parsed.content ? 'has content' : '');
    switch (parsed.type) {
      case 'content':
        if (parsed.content) {
          setCurrentAnswer(prev => prev + parsed.content);
        }
        break;
      case 'status':
        setStatus({ status: parsed.status, stage: parsed.stage });
        break;
      case 'citations':
        if (parsed.citations) {
          setCitations(parsed.citations);
        }
        break;
      case 'conversationId':
        if (parsed.id) {
          setConversationId(parsed.id);
          sseConversationIdRef.current = parsed.id;
          // Update URL with conversation ID
          setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('conversation', parsed.id);
            return newParams;
          });
        }
        break;
      case 'ocr_text':
        if (parsed.text) {
          setOcrText(parsed.text);
          setShowOcrPreview(true);
        }
        break;
      case 'image_pending':
        setGeneratingImage(true);
        break;
      case 'image_ready':
        if (parsed.image) {
          setGeneratedImageData(parsed.image);
          setGeneratingImage(false);
        }
        break;
      case 'error':
        console.error('[Chat] SSE error event:', parsed);
        setError(parsed.message || parsed.error || 'An error occurred');
        break;
      case 'permission':
        // Handle permission prompt from backend
        if (parsed.permissionPrompt) {
          setPermissionPrompt(parsed.permissionPrompt);
          setStreaming(false);
        }
        break;
      default:
        // Handle legacy events (status without type)
        if (parsed.status) {
          setStatus({ status: parsed.status, stage: parsed.stage });
        } else if (parsed.content) {
          setCurrentAnswer(prev => prev + parsed.content);
        } else if (parsed.needsPermission && parsed.permissionPrompt) {
          // Legacy format support
          setPermissionPrompt(parsed.permissionPrompt);
          setStreaming(false);
        }
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

    const userMessage = {
      role: 'user',
      content: confirmed ? 'Yes, search the web' : 'No, I\'ll rephrase my question',
      citations: [],
      attachments: [],
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    if (!confirmed) {
      setPermissionPrompt(null);
      setPendingQuery(null);
      // Focus input for rephrasing
      textareaRef.current?.focus();
      return;
    }

    // User confirmed - call confirm-web-search
    setLoading(true);
    setStreaming(true);
    setCurrentAnswer('');
    setPermissionPrompt(null);
    setStatus({ status: 'Searching the web...', stage: 'webSearch' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 240000); // 240s timeout

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/chat/confirm-web-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: pendingQuery, subject, conversationId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Chat] Web search server error:', res.status, errorText);
        setError(`Server error: ${res.status} - ${errorText}`);
        setStreaming(false);
        setLoading(false);
        return;
      }

      console.log('[Chat] Confirm-web-search SSE stream started, content-type:', res.headers.get('content-type'));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';
      let buffer = '';
      let eventCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6).trim();
            if (data === '[DONE]') {
              console.log('[Chat] Confirm-web-search received [DONE] event');
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              eventCount++;
              console.log(`[Chat] Confirm-web-search SSE event #${eventCount}:`, parsed.type, parsed.status || parsed.content ? 'content' : '');
              handleStreamEvent(parsed);
              if (parsed.type === 'content' && parsed.content) {
                fullAnswer += parsed.content;
              }
            } catch (parseErr) {
              console.warn('[Chat] Failed to parse SSE data:', data, parseErr);
              fullAnswer += data;
              setCurrentAnswer(fullAnswer);
            }
          }
        }
      }

      if (buffer) {
        try {
          const trimmedBuffer = buffer.trim();
          if (trimmedBuffer.startsWith('data: ')) {
            const data = trimmedBuffer.slice(6).trim();
            if (data !== '[DONE]') {
              const parsed = JSON.parse(data);
              handleStreamEvent(parsed);
              if (parsed.type === 'content' && parsed.content) {
                fullAnswer += parsed.content;
              }
            }
          }
        } catch {
          fullAnswer += buffer;
          setCurrentAnswer(fullAnswer);
        }
      }

      if (fullAnswer.trim()) {
        const assistantMessage = {
          role: 'assistant',
          content: fullAnswer,
          citations,
          webSources: [],
          isWebSearch: true,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        setError('No answer received from web search, please try again.');
      }
      setStreaming(false);

    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Web search timed out. Please try again.');
      } else {
        console.error('Web search confirmation error:', err);
        setError('Failed to search the web. Please try again.');
      }
      setStreaming(false);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setPendingQuery(null);
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

  const suggestionPrompts = [...getExamplePrompts(), ...EXAMPLE_PROMPTS.default]
    .filter((prompt, index, all) => all.indexOf(prompt) === index)
    .slice(0, 5);
  const suggestionLabels = SUGGESTION_LABELS[subject] || SUGGESTION_LABELS.default;

  const surpriseMe = () => {
    const pool = [...getExamplePrompts(), ...EXAMPLE_PROMPTS.default];
    const prompt = pool[Math.floor(Math.random() * pool.length)];
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
                    {status ? (
                      <span className="pu-status">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {getStatusText()}
                      </span>
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                  </div>
                  <div className="pu-msg-bubble">
                    <div className="whitespace-pre-wrap">
                      {currentAnswer || (status ? getStatusText() : '')}
                      {currentAnswer && <span className="pu-stream-caret" />}
                    </div>
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
                  setError('');
                  handleAsk(new Event('submit', { cancelable: true }));
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
                  {(pendingFile?.size / 1024).toFixed(1)} KB
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
            <div className="pu-composer">
              <div className="pu-plus-wrap" ref={plusMenuRef}>
                <button
                  type="button"
                  onClick={() => setPlusMenuOpen((value) => !value)}
                  disabled={loading || streaming || generatingImage}
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

              {question.trim() || pendingFile ? (
                <button
                  type="submit"
                  className="pu-mic-btn"
                  disabled={
                    (!question.trim() && !pendingFile) ||
                    !subject ||
                    loading ||
                    streaming ||
                    generatingImage
                  }
                  aria-label="Send message"
                >
                  {loading || streaming || generatingImage ? (
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
                <div className="pu-sugg-row pu-sugg-row-1">
                  {suggestionPrompts.slice(0, 3).map((prompt, index) => (
                    <button
                      key={prompt}
                      type="button"
                      className="pu-sugg"
                      title={prompt}
                      onClick={() => {
                        setQuestion(prompt);
                        textareaRef.current?.focus();
                      }}
                    >
                      {suggestionLabels[index]}
                    </button>
                  ))}
                </div>
                <div className="pu-sugg-row pu-sugg-row-2">
                  {suggestionPrompts.slice(3, 5).map((prompt, index) => (
                    <button
                      key={prompt}
                      type="button"
                      className="pu-sugg"
                      title={prompt}
                      onClick={() => {
                        setQuestion(prompt);
                        textareaRef.current?.focus();
                      }}
                    >
                      {suggestionLabels[index + 3]}
                    </button>
                  ))}
                  <button type="button" className="pu-sugg-big" onClick={surpriseMe}>
                    Surprise me
                  </button>
                </div>
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
