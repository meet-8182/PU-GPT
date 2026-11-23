import mongoose from 'mongoose';

const universityInfoAuditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'upload',
      'quick-fact',
      'approve',
      'unapprove',
      'replace',
      'delete',
      'reprocess',
      'settings',
    ],
  },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityInfo' },
  documentTitle: { type: String },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorEmail: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

universityInfoAuditSchema.index({ createdAt: -1 });

export const UniversityInfoAudit = mongoose.model(
  'UniversityInfoAudit',
  universityInfoAuditSchema
);
