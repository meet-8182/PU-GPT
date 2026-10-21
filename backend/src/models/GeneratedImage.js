import mongoose from 'mongoose';

const generatedImageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  prompt: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },
  width: {
    type: Number,
    required: true,
    min: 64,
    max: 1024,
  },
  height: {
    type: Number,
    required: true,
    min: 64,
    max: 1024,
  },
  seed: {
    type: Number,
  },
  filePath: {
    type: String,
    required: false,
  },
  fileName: {
    type: String,
    required: false,
  },
  fileSize: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'done', 'failed'],
    default: 'queued',
    index: true,
  },
  error: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for user history queries
generatedImageSchema.index({ userId: 1, createdAt: -1 });
generatedImageSchema.index({ status: 1 });

generatedImageSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  if (typeof next === 'function') {
    next();
  }
});

export const GeneratedImage = mongoose.model('GeneratedImage', generatedImageSchema);