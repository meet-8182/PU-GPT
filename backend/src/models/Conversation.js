import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  // "pdf" is a first-class attachment type: uploaded PDFs are kept on disk and
  // referenced by URL so a reopened conversation can restore the file without
  // embedding megabytes of base64 in the conversation document.
  type: { type: String, enum: ['image', 'pdf', 'generated_image'], required: true },
  url: { type: String, required: true },
  mimeType: { type: String, required: true },
  originalName: { type: String },
  size: { type: Number },
  width: { type: Number },
  height: { type: Number },
  prompt: { type: String },
  ocrText: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  // Used to keep non-substantive turns (greetings, permission offers,
  // clarification prompts) out of the follow-up history.
  kind: {
    type: String,
    enum: ['normal', 'greeting', 'permission-offer', 'clarification', 'command'],
    default: 'normal',
  },
  citations: [{
    chunkId: { type: String },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    excerpt: { type: String },
    page: { type: Number },
    score: { type: Number },
  }],
  attachments: [attachmentSchema],
  // Persisted so reopened conversations keep the "Web" badge.
  isWebSearch: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
  tokenCount: { type: Number, default: 0 },
});

const conversationSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true, trim: true },
  title: { type: String, trim: true },
  // The topic a follow-up message refers to (e.g. "stack"). Persisted so it
  // survives a page reload and never leaks between chats.
  focusTopic: { type: String, trim: true, default: null },
  messages: [messageSchema],
  summary: { type: String, trim: true, default: '' },
  summaryTokenCount: { type: Number, default: 0 },
  lastSummarizedAt: { type: Date },
  lastSummarizedMessageIndex: { type: Number, default: -1 },
  memoryEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

conversationSchema.index({ studentId: 1, createdAt: -1 });
conversationSchema.index({ studentId: 1, subject: 1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);