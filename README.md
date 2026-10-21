# PU-GPT — Parul University Curriculum Assistant

A self-hosted curriculum question-answering system for Parul University. Teachers upload course materials, students ask questions and get cited answers grounded strictly in that material.

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: MongoDB
- **Vector Store**: Chroma (dev) → Qdrant (production)
- **LLM**: Ollama (Qwen3-30B-A3B for answers, Phi-4-14B for reasoning)
- **Embeddings**: bge-m3 via Ollama
- **OCR**: glm-ocr via Ollama
- **Image Generation**: x/z-image-turbo via Ollama (experimental)
- **Auth**: JWT with role-based access (student/teacher/admin)
- **Job Queue**: BullMQ + Redis (for image generation)

## Prerequisites

- Node.js 18+
- MongoDB 6+
- Ollama (for LLM serving)
- Chroma (for vector storage)
- Redis (for BullMQ job queue)
- Poppler (for PDF OCR - `apt install poppler-utils` / `brew install poppler` / `choco install poppler`)

## Quick Start

### 1. Start Required Services

```bash
# Start MongoDB (if not running as service)
mongod

# Start Chroma
docker run -p 8000:8000 chromadb/chroma

# Start Redis
redis-server

# Start Ollama and pull models
ollama serve
ollama pull qwen3:30b-a3b
ollama pull phi4:14b
ollama pull bge-m3
ollama pull glm-ocr
ollama pull x/z-image-turbo
```

**Note on Image Generation Model**: `x/z-image-turbo` is experimental and may not be supported on all operating systems. If `ollama pull x/z-image-turbo` fails or the model doesn't work, the image generation feature will gracefully degrade with a clear error message.

**Note on PDF OCR**: For OCR on scanned PDFs, poppler must be installed on the system. This is required by `pdf2pic` which rasterizes PDF pages to images before OCR.

### 2. Configure Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your settings if needed
```

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Run Development Servers

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### 5. Access the Application

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Project Structure

```
PU-GPT/
├── backend/
│   ├── src/
│   │   ├── config/         # Configuration
│   │   ├── middleware/     # Auth, validation, error handling, rate limiting
│   │   ├── models/         # MongoDB models (User, Document, Conversation, GeneratedImage, Taxonomy)
│   │   ├── routes/         # API routes (auth, documents, chat, teacher, admin, images)
│   │   ├── services/       # Business logic (ingestion, chat, ocr, imageGen, imageQueue)
│   │   ├── utils/          # Utilities (fileValidation, promptModeration)
│   │   └── index.js        # Entry point
│   └── uploads/            # Uploaded files (including generated/)
├── frontend/
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── context/        # React context (Auth, Theme)
│   │   ├── pages/          # Page components (AskPage, HistoryPage, LibraryPage, InsightsPage, ImageStudio, Admin pages)
│   │   ├── utils/          # API client
│   │   ├── styles/         # Global styles
│   │   ├── App.jsx         # Main app with routing
│   │   └── main.jsx        # Entry point
│   └── index.html
└── master_build_prompt.md  # Project specification
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register (admin-provisioned for teachers)
- `GET /api/auth/me` - Get current user

### Documents (Teacher/Admin)
- `POST /api/documents/upload` - Upload document (multipart) - now supports images and scanned PDFs with OCR
- `GET /api/documents` - List documents with filters
- `GET /api/documents/subjects` - Get unique subjects
- `DELETE /api/documents/:id` - Delete document

### Images (All Roles)
- `GET /api/images/health` - Health check for OCR and image generation models
- `POST /api/images/ocr` - Extract text from image/PDF (multipart upload)
- `POST /api/images/generate` - Create image generation job
- `GET /api/images/jobs/:id` - Get job status (owner or admin)
- `GET /api/images/history` - Paginated list of user's generated images
- `GET /api/images/file/:id` - Serve generated image (auth required)
- `DELETE /api/images/:id` - Delete generated image (owner or admin)

### Chat (Student)
- `POST /api/chat/ask` - Ask question (streams response)
- `GET /api/chat/history` - Get conversation history
- `GET /api/chat/history/:id` - Get single conversation
- `DELETE /api/chat/history/:id` - Delete conversation
- `GET /api/chat/flagged` - Get flagged questions
- `POST /api/chat/web-search` - Direct web search
- `POST /api/chat/confirm-web-search` - Confirm web search after permission prompt

### Teacher
- `GET /api/teacher` - List flagged questions
- `POST /api/teacher/:id/respond` - Respond to flagged question
- `GET /api/teacher/insights` - Get topic insights

### Admin
- `GET /api/admin/departments` - List departments
- `POST /api/admin/departments` - Create department
- `DELETE /api/admin/departments/:name` - Delete department
- `GET /api/admin/subjects` - List subjects
- `POST /api/admin/subjects` - Create subject
- `POST /api/admin/teachers` - Create teacher account
- `GET /api/admin/users` - List users
- `PATCH /api/admin/users/:id/role` - Update user role
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/status` - System status (includes OCR/image-gen model availability)

## Features

### Image-to-Text (OCR)
- Students can attach images/PDFs to questions in the Ask page
- OCR extracts text using `glm-ocr` via Ollama
- Extracted text is shown editable before sending to chat
- Teachers can upload images/scanned PDFs to the library - automatically OCR'd and indexed
- Scanned PDFs are rasterized page-by-page using pdf2pic + poppler

### Text-to-Image Generation
- Accessible via Image Studio page (`/studio`)
- Generate images from prompts using `x/z-image-turbo` via Ollama
- Job queue (BullMQ + Redis) with concurrency control (default 1) to prevent VRAM starvation
- Size presets: 512×512, 768×768, 1024×1024, 768×512, 512×768
- History grid with download and delete
- Model availability checked at startup and via health endpoint

### Safety & Limits
- File type validation by magic bytes (not just extension)
- Max upload size: 10MB (configurable)
- Rate limiting per user: 10 OCR/min, 3 generate/min, 30 history/min
- Prompt validation: max 2000 chars, blocklist for university setting (extensible)
- Filename sanitization and path traversal prevention
- Temp files cleaned up after processing
- Raw Ollama errors never returned to client

## Roles

- **Student**: Ask questions, view history, see flagged questions, use OCR on images, generate images
- **Teacher**: Upload documents (including images/scanned PDFs with OCR), manage library, respond to flagged questions, view insights, generate images
- **Admin**: Manage departments/subjects, user management, system status, generate images

## Design System

The UI follows a "chalkboard and annotated textbook" design language:
- **Colors**: Chalkboard (#1E2B24), Chalk (#EDEDE3), Amber Chalk (#E8B84B), Rule Line (#3A4A40), Sage (#7FA88F), Rust (#C1694F)
- **Typography**: Source Serif 4 (display), Inter/IBM Plex Sans (body), IBM Plex Mono (citations)
- **Citations**: Margin notes with leader lines (desktop) / expandable bottom sheets (mobile)

## Production Deployment

1. Replace Chroma with Qdrant for vector storage
2. Use a reverse proxy (nginx) for frontend/backend
3. Set up MongoDB with authentication
4. Configure environment variables for production
5. Use PM2 or similar for process management
6. Set up SSL/TLS certificates
7. Ensure Redis is configured for production
8. Install poppler for PDF OCR support

## License

Internal use only — Parul University