# PuGPT Test Checklist - Web Search & File Upload Fixes

## Backend Fixes Verified

### 1. sanitizeQuery is now a proper named export
- ✅ Exported as `export function sanitizeQuery(query, subject)` in `services/chat.js`
- ✅ Imported correctly in `routes/chat.js` as `import { sanitizeQuery } from '../services/chat.js'`
- ✅ No more dynamic import or module mismatch

### 2. Web Search Trigger ("\") - Backend Detection Only
- ✅ New `detectWebSearchTrigger(query)` function detects leading `\` or `＼`
- ✅ Returns `{ query: cleaned, isWebSearch: boolean }`
- ✅ Called FIRST in both route and service, BEFORE sanitization
- ✅ Frontend sends raw question, backend handles trigger detection
- ✅ Order: trim → detect trigger → strip backslash → sanitize → expand with subject

### 3. Multipart Body Parsing
- ✅ Multer configured with `upload.single('file')` accepting PNG/JPEG/WebP/PDF
- ✅ Route reads `req.body.question`, `req.body.subject`, `req.body.conversationId`
- ✅ File available at `req.file.buffer` and `req.file.mimetype`
- ✅ Frontend FormData field names match: `question`, `subject`, `conversationId`, `file`
- ✅ Frontend does NOT set Content-Type (lets browser set multipart boundary)

### 4. Permission Flow Works
- ✅ If RAG finds nothing (no file attached), returns `needsPermission: true`
- ✅ Frontend shows permission prompt with "Yes/No" buttons
- ✅ "Yes" calls `/api/chat/confirm-web-search` with original question + file
- ✅ "No" dismisses prompt and focuses input
- ✅ Web search runs with sanitized query

### 5. Web Search Path Robustness
- ✅ Logs: original query, sanitized query, expanded query, Tavily status, result count
- ✅ If Tavily fails or returns 0 results → sends `type: 'error'` event then `[DONE]`
- ✅ Does NOT call LLM with empty context
- ✅ Results formatted as plain text: `[N] Title\nURL\nSnippet`
- ✅ System prompt instructs: "Answer ONLY the user's question using the context"
- ✅ User question explicitly in user message

### 6. Error Handling & Stream Management
- ✅ Route wrapped in try/catch
- ✅ Stream iteration wrapped in try/catch
- ✅ On stream error: sends `type: 'error'` event if headers not ended
- ✅ Always ends stream with `[DONE]`
- ✅ Frontend: `setLoading(false)` in finally block, Retry button, clear error display

## Frontend Verification

### File Upload
- ✅ File input accepts: `image/png,image/jpeg,image/webp,application/pdf`
- ✅ Preview shows for images, PDF icon for PDFs
- ✅ Pending file chip above input with remove button
- ✅ On send: file moves into message, pending chip clears
- ✅ Attachments rendered inside user message bubble

### Web Search Trigger
- ✅ User types `\ what is dsa` → frontend sends raw question
- ✅ Backend detects `\`, sets `isWebSearch=true`, strips it
- ✅ Backend sanitizes `what is dsa` → `Data Structures and Algorithms`
- ✅ Direct web search (skips RAG)

### Conversation Reset
- ✅ Changing subject clears messages AND pending file
- ✅ `removePendingFile()` revokes blob URLs

## Test Scenarios

### (A) Basic RAG Query
- **Input**: "what is binary search" (Data Structures subject)
- **Expected**: RAG finds chunks → streams answer with citations

### (B) Web Search Trigger
- **Input**: `\ what is quantum computing`
- **Expected**: Backend detects `\`, skips RAG, calls Tavily, streams web answer
- **Logs**: `[Route] isWebSearch: true`, `[WebSearch] Expanded query: quantum computing Data Structures`

### (C) File Upload + Question
- **Input**: Attach diagram.png + "explain this diagram"
- **Expected**: Vision model analyzes image → answer includes image analysis + RAG context

### (D) PDF Upload + Text Question
- **Input**: Attach notes.pdf + "summarize this"
- **Expected**: Text extracted → included in prompt → text LLM answers

### (E) PDF Upload + Visual Question
- **Input**: Attach slides.pdf + "what logo is on slide 2?"
- **Expected**: PDF converted to images (first 5) → vision model analyzes → answer

### (F) No RAG Match → Permission → Web Search
- **Input**: "what is blockchain" (not in course material)
- **Expected**: Permission prompt → Click "Yes" → Web search runs → Answer streams

### (G) Follow-up with File Context
- **Setup**: Complete (C) or (D)
- **Input**: "what about the second part?"
- **Expected**: File data from previous turn included in context

### (H) Error Cases
- **Too large file**: Frontend blocks >10MB, backend also validates
- **Unsupported type**: Frontend/backend reject .docx, .txt
- **No API key**: Returns "I couldn't find relevant information on the web..."
- **Tavily error**: Returns error event, doesn't crash

### (I) Edge Cases
- **Empty query with file**: Default "Explain this file" used
- **Only backslash**: `\ ` → stripped to empty → blocked
- **Full-width backslash**: `＼question` → detected correctly
- **Multiple backslashes**: `\\question` → stripped to `question`

## Debug Logs to Check

### Backend Console
```
[Route] Raw question: \ what is dsa
[Route] isWebSearch: true
[Route] Stripped query: what is dsa
[Route] Sanitized query: Data Structures and Algorithms
[Route] Has file: false
[WebSearch] Original query: Data Structures and Algorithms
[WebSearch] Sanitized query: Data Structures and Algorithms
[WebSearch] Expanded query for search: Data Structures and Algorithms Data Structures
[WebSearch] Tavily response status: 200
[WebSearch] Tavily results count: 5
[WebSearchLLM] Final system prompt length: 2341
[WebSearchLLM] Final user message: Data Structures and Algorithms
```

### Frontend Console
```
[Chat] Raw question: \ what is dsa hasFile: false
[Chat] Subject: Data Structures Raw query: \ what is dsa File: undefined
```

## Configuration Required

### Backend .env
```bash
TAVILY_API_KEY=your-key-here  # Required for web search
VISION_MODEL=llava-llama3:8b  # Ollama vision model
MAX_FILE_SIZE=10485760        # 10MB
```

### Ollama Models Required
- `qwen2.5:3b-instruct-q4_K_M` (text LLM)
- `llava-llama3:8b` (vision model)

## Rollback Points
If issues persist:
1. Check `sanitizeQuery` export in `services/chat.js` line 62
2. Verify `detectWebSearchTrigger` is called before sanitization in route line 65
3. Ensure frontend doesn't send `isWebSearch` flag (removed from api.js)
4. Verify multer field name is `file` (matches frontend FormData.append('file', file))