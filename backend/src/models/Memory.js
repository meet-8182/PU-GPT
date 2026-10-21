import mongoose from 'mongoose';

const memorySchema = new mongoose.Schema({
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  content: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 2000
  },
  category: { 
    type: String, 
    enum: ['preference', 'goal', 'project', 'fact', 'style', 'other'],
    default: 'other'
  },
  source: {
    type: String,
    enum: ['explicit', 'extracted'],
    default: 'explicit'
  },
  confidence: { 
    type: Number, 
    default: 1.0,
    min: 0,
    max: 1
  },
  metadata: {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    subject: { type: String, trim: true },
    extractedAt: { type: Date }
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

memorySchema.index({ studentId: 1, isActive: 1, category: 1 });
memorySchema.index({ studentId: 1, createdAt: -1 });
memorySchema.index({ studentId: 1, content: 'text' });

memorySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const Memory = mongoose.model('Memory', memorySchema);