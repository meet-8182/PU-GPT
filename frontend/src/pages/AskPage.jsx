import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader2, Flag, AlertCircle, Copy, Check, FileText, ChevronDown, ChevronUp, ExternalLink, Image, X, Edit2, Plus, X as XIcon, RefreshCw, History } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { api } from '@/utils/api';
import { MessageRenderer } from '@/components/ui/MessageRenderer';
import { chatApi } from '@/utils/api';
import { ConversationHistoryPanel } from '@/components/ui/ConversationHistoryPanel';

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
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [citations, setCitations] = useState([]);
  const [showCitations, setShowCitations] = useState({});
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
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  // Track the last loaded conversation ID to prevent duplicate loads
  const lastLoadedConvIdRef = useRef(null);

  // Helper to remove pending file - must be defined before loadConversation
  const removePendingFile = () => {
    if (pendingFilePreview && pendingFilePreview.startsWith('blob:')) {
      URL.revokeObjectURL(pendingFilePreview);
    }
    setPendingFile(null);
    setPendingFilePreview(null);
    setOcrText('');
    setShowOcrPreview(false);
  };

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
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setError('Failed to load conversation');
      setMessages([]);
      setConversationId(null);
    } finally {
      setLoading(false);
    }
  }, [removePendingFile]);

  // Fetch subjects
  const fetchSubjects = useCallback(async () => {
    try {
      await api.get('/chat/history', {
        params: { limit: 1 },
      });
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    }

    const userSubjects = user?.subjects || [];

    setSubjects(userSubjects);

    if (userSubjects.length > 0 && !subject) {
      setSubject(userSubjects[0]);
    }
  }, [user, subject]);

  // Authentication and subjects loading
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    fetchSubjects();
  }, [isAuthenticated, navigate, fetchSubjects]);

  // Extract conversation ID from URL as a primitive for stable dependency
  const urlConversationId = searchParams.get('conversation');
  const urlIsNewChat = searchParams.get('new') === 'true';

  // Handle URL parameters (new chat, conversation ID)
  useEffect(() => {
    if (!isAuthenticated) return;

    // Check for new chat parameter
    if (urlIsNewChat) {
      // Clear the new parameter from URL
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('new');
        return newParams;
      });
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
    }
  }, [
    isAuthenticated,
    urlConversationId,
    urlIsNewChat,
    setSearchParams,
    loadConversation,
    conversationId,
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
    // Clear conversation from URL
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('conversation');
      return newParams;
    });
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
      console.log('[Chat] Token:', token ? 'present' : 'MISSING');
      console.log('[Chat] Subject:', subject, 'Raw query:', rawQuestion, 'File:', fileToSend?.name);

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

  const emptyState = messages.length === 0 && !streaming && !currentAnswer && !showOcrPreview && !generatingImage;
  const isWebSearchMode = question.startsWith('\\');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-medium text-2xl text-chalk mb-1">Ask a Question</h1>
        <p className="text-chalk/60">Get answers grounded in your course material</p>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <Select
          label="Subject"
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder="Select a subject"
          options={subjects.map(s => ({ value: s, label: s }))}
          error={!subject && messages.length > 0 ? 'Please select a subject' : undefined}
        />
        {conversationId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            className={showHistoryPanel ? 'bg-sage/10 text-sage' : ''}
            aria-label="Toggle conversation history"
          >
            <History className="w-4 h-4 mr-1" />
            History
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className="animate-in">
            <div className="flex gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user' ? 'bg-amber-chalk/20' : 'bg-sage/20'
              }`}>
                {msg.role === 'user' ? (
                  <span className="text-amber-chalk text-sm font-medium">{user?.name?.charAt(0).toUpperCase()}</span>
                ) : (
                  <FileText className="w-4 h-4 text-sage" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                  <span className="text-xs text-chalk/40">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  {msg.isWebSearch && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-sage/20 text-sage rounded-full">
                      Web Search
                    </span>
                  )}
                </div>
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
          <div key="permission-prompt" className="animate-in">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-sage" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">Assistant</span>
                  <span className="text-xs text-chalk/40">{new Date().toLocaleTimeString()}</span>
                  <span className="px-1.5 py-0.5 text-xs font-medium bg-sage/20 text-sage rounded-full">
                    Web Search
                  </span>
                </div>
                <div className="bg-sage/10 border border-sage/20 rounded-lg p-4">
                  <p className="text-chalk/90 mb-4">{permissionPrompt.message}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handlePermissionResponse(true)}
                    >
                      Yes, search the web
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handlePermissionResponse(false)}
                    >
                      No, I'll rephrase
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {streaming && (
        <div className="animate-in">
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-sage" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">Assistant</span>
                {status && (
                  <span className="text-xs text-sage flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {getStatusText()}
                  </span>
                )}
                {!status && <Loader2 className="w-4 h-4 animate-spin text-amber-chalk" />}
              </div>
              <div className="font-display prose prose-invert max-w-none whitespace-pre-wrap">
                {currentAnswer || (status ? getStatusText() : '')}
                {currentAnswer && <span className="inline-block w-1 h-6 bg-amber-chalk animate-pulse ml-1" />}
              </div>
              {generatingImage && (
                <div className="mt-3 flex items-center gap-2 text-sage">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating image...</span>
                </div>
              )}
              {generatedImageData && (
                <div className="mt-3">
                  <img
                    src={generatedImageData.dataUrl}
                    alt={`Generated: ${generatedImageData.prompt}`}
                    className="max-w-full h-auto rounded-lg border border-rule-line"
                    style={{ maxHeight: '400px' }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rust/10 border border-rust/30 rounded-lg text-rust text-sm" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError('');
              handleAsk(new Event('submit', { cancelable: true }));
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Retry
          </Button>
        </div>
      )}

      {/* OCR Preview */}
      {showOcrPreview && ocrText && (
        <div className="mb-4 animate-in bg-sage/5 border border-sage/20 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <Image className="w-5 h-5 text-sage" />
              <span className="font-medium text-chalk">Extracted Text (OCR)</span>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={useOcrText}>
                <Check className="w-3.5 h-3.5" />
                Use This Text
              </Button>
              <Button variant="secondary" size="sm" onClick={editOcrText}>
                <Edit2 className="w-3.5 h-3.5" />
                Edit First
              </Button>
              <Button variant="ghost" size="sm" onClick={discardOcrText} className="text-rust">
                <X className="w-3.5 h-3.5" />
                Discard
              </Button>
            </div>
          </div>
          <textarea
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            className="w-full min-h-[100px] max-h-[200px] px-3 py-2 rounded-lg bg-chalkboard/50 border border-rule-line text-chalk placeholder:text-chalk/40 resize-none focus:outline-none focus:border-sage font-body text-sm"
            rows={4}
            placeholder="OCR result - you can edit before using..."
          />
          <p className="text-xs text-chalk/40 mt-2 text-right">
            Review and correct any OCR errors before sending
          </p>
        </div>
      )}

      <form onSubmit={handleAsk} className="space-y-4" noValidate>
        {emptyState && (
          <div className="card">
            <p className="text-chalk/60 mb-4">Try asking something like:</p>
            <div className="flex flex-wrap gap-2">
              {getExamplePrompts().map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setQuestion(prompt); textareaRef.current?.focus(); }}
                  className="px-3 py-1.5 text-sm text-chalk/80 bg-rule-line/30 border border-rule-line rounded-lg hover:bg-amber-chalk/10 hover:border-amber-chalk/30 transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pending File Preview (Image or PDF) - shows above input for files not yet sent */}
        {pendingFile && (
          <div className="relative bg-sage/5 border border-sage/20 rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-chalkboard/30 flex items-center justify-center">
                {pendingFilePreview ? (
                  <img
                    src={pendingFilePreview}
                    alt={pendingFile?.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full">
                    {getFileIcon(pendingFile?.type)}
                    <span className="text-xs text-chalk/50 mt-1">PDF</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-chalk truncate">{pendingFile?.name}</p>
                <p className="text-xs text-chalk/50">{(pendingFile?.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                type="button"
                onClick={removePendingFile}
                className="p-2 rounded-lg bg-rust/10 text-rust hover:bg-rust/20 transition-colors"
                aria-label="Remove file"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={emptyState ? 'Ask a question about your course material...' : 'Ask a follow-up... (Type \\ for web search)'}
            className="w-full min-h-[100px] max-h-[300px] px-4 py-3 rounded-xl bg-rule-line/30 border border-rule-line text-chalk placeholder:text-chalk/40 resize-none focus:outline-none focus:border-amber-chalk focus:ring-2 focus:ring-amber-chalk/20 font-body"
            rows={3}
            disabled={loading || streaming || generatingImage}
            aria-label="Your question"
          />
          {question.startsWith('\\\\') && (
            <span className="absolute top-3 right-10 px-2 py-1 text-xs font-medium bg-sage/20 text-sage rounded-full">
              Web Search Mode
            </span>
          )}
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || streaming || generatingImage}
              className="p-2 rounded-lg bg-rule-line/30 text-chalk/60 hover:bg-amber-chalk/10 hover:text-amber-chalk transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Attach file"
            >
              <Plus className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />
            <Button
              type="submit"
              loading={loading || streaming || generatingImage}
              disabled={(!question.trim() && !pendingFile) || !subject || loading || streaming || generatingImage}
              size="sm"
            >
              <Send className="w-4 h-4" />
              {streaming ? 'Streaming...' : generatingImage ? 'Generating...' : 'Ask'}
            </Button>
          </div>
        </div>

        <p className="text-xs text-chalk/40 text-center">
          Press Enter to send, Shift+Enter for new line. Type <kbd className="px-1.5 py-0.5 bg-rule-line/50 rounded text-xs font-mono">\\</kbd> for web search. Click + to attach an image or PDF for analysis.
        </p>
      </form>

      {/* Conversation History Panel */}
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