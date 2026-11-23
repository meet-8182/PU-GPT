import mongoose from 'mongoose';

/**
 * Admin-approved university information used by the pre-login guest chat.
 *
 * This is deliberately a separate collection from course `Document`s: guest
 * retrieval can only ever read the `pu_info` Chroma collection, which is built
 * from these records.
 */
export const INFO_CATEGORIES = [
  'admissions',
  'programs',
  'fees',
  'scholarships',
  'campus',
  'hostel',
  'placements',
  'rules',
  'events',
  'contact',
  'other',
];

export const INFO_STATUSES = ['draft', 'approved', 'superseded', 'expired'];

const universityInfoSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  category: { type: String, enum: INFO_CATEGORIES, default: 'other', required: true },
  version: { type: Number, default: 1, min: 1 },
  effectiveFrom: { type: Date, required: true },
  validUntil: { type: Date },
  lastReviewed: { type: Date, default: Date.now },
  approved: { type: Boolean, default: false },
  status: { type: String, enum: INFO_STATUSES, default: 'draft' },
  sourceDoc: { type: String, required: true, trim: true },
  page: { type: Number },
  // Uploaded source (PDF/DOCX/TXT/image). Quick facts store text only.
  fileUrl: { type: String },
  fileType: { type: String },
  fileSize: { type: Number },
  fileHash: { type: String },
  // Extracted/stored text so reprocessing and preview do not depend on disk.
  text: { type: String },
  isQuickFact: { type: Boolean, default: false },
  chunkCount: { type: Number, default: 0 },
  contentHash: { type: String },
  warnings: [{ type: String }],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityInfo' },
  replaces: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityInfo' },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

universityInfoSchema.index({ status: 1, approved: 1 });
universityInfoSchema.index({ category: 1 });
universityInfoSchema.index({ validUntil: 1 });
universityInfoSchema.index({ fileHash: 1 });

universityInfoSchema.pre('save', function updateTimestamp() {
  this.updatedAt = new Date();
});

export const UniversityInfo = mongoose.model('UniversityInfo', universityInfoSchema);
