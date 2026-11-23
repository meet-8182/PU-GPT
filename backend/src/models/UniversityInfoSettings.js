import mongoose from 'mongoose';

export const DEFAULT_CONTACT_BLOCK = `Parul University Admissions Office
Phone: +91 2668 260 000
Email: admissions@paruluniversity.ac.in
Website: https://paruluniversity.ac.in`;

export const DEFAULT_DISCLAIMER =
  'Answers on this page come only from university information approved by Parul University staff. '
  + 'Chats are not saved. For personal or admission-specific advice, please log in or contact the university.';

const universityInfoSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  contactBlock: { type: String, default: DEFAULT_CONTACT_BLOCK },
  disclaimer: { type: String, default: DEFAULT_DISCLAIMER },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now },
});

export const UniversityInfoSettings = mongoose.model(
  'UniversityInfoSettings',
  universityInfoSettingsSchema
);
