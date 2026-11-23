/**
 * Seed data for the guest-mode acceptance run.
 *
 * Creates two approved university-information documents from the clearly marked
 * test files in eval/pu-info-docs, indexes them into the `pu_info` Chroma
 * collection, and creates test admin/student accounts plus the contact block.
 *
 * Run from the backend directory so backend/.env is loaded:
 *   node ../tests/acceptance/seed.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { config } from '../../src/config/index.js';
import {
  User,
  UniversityInfo,
  UniversityInfoSettings,
  DEFAULT_DISCLAIMER,
} from '../../src/models/index.js';
import { indexUniversityInfo, deleteUniversityInfoChunks } from '../../src/services/puInfo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const ADMIN_EMAIL = 'guest-admin@test.local';
const ADMIN_PASSWORD = 'GuestAdmin!2345';
const STUDENT_EMAIL = 'guest-student@test.local';
const STUDENT_PASSWORD = 'GuestStudent!2345';

async function ensureUser({ email, password, name, role, extra = {} }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ email, passwordHash: 'placeholder', name, role, ...extra });
  } else {
    Object.assign(user, { name, role, ...extra });
  }
  user.passwordHash = password;
  await user.save();
  return user;
}

async function upsertDocument({ adminId, title, category, sourceDoc, text }) {
  const existing = await UniversityInfo.find({ title }).select('_id').lean();
  for (const doc of existing) {
    try {
      await deleteUniversityInfoChunks(doc._id);
    } catch (error) {
      console.warn('Could not clear old chunks:', error.message);
    }
  }
  await UniversityInfo.deleteMany({ title });

  const document = await UniversityInfo.create({
    title,
    category,
    version: 1,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: null,
    lastReviewed: new Date(),
    approved: true,
    status: 'approved',
    sourceDoc,
    text,
    contentHash: 'seed',
    uploadedBy: adminId,
    approvedBy: adminId,
    approvedAt: new Date(),
  });

  const result = await indexUniversityInfo(document, { text });
  return { document, chunkCount: result.chunkCount };
}

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 30000 });
  console.log('Connected to MongoDB');

  const admin = await ensureUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: 'Guest Test Admin',
    role: 'admin',
  });
  const student = await ensureUser({
    email: STUDENT_EMAIL,
    password: STUDENT_PASSWORD,
    name: 'Guest Test Student',
    role: 'student',
    extra: {
      college: 'Parul University',
      program: 'btech',
      field: 'Computer Engineering',
      fieldCategory: 'Engineering',
      semester: '1',
      subjects: ['Computer Science'],
    },
  });

  const admissionsText = fs.readFileSync(
    path.join(repoRoot, 'eval', 'pu-info-docs', 'test-admissions.md'),
    'utf-8'
  );
  const hostelText = fs.readFileSync(
    path.join(repoRoot, 'eval', 'pu-info-docs', 'test-hostel.md'),
    'utf-8'
  );

  const admissions = await upsertDocument({
    adminId: admin._id,
    title: 'Test Admissions Information (NOT REAL DATA)',
    category: 'admissions',
    sourceDoc: 'test-admissions.md',
    text: admissionsText,
  });
  const hostel = await upsertDocument({
    adminId: admin._id,
    title: 'Test Hostel Information (NOT REAL DATA)',
    category: 'hostel',
    sourceDoc: 'test-hostel.md',
    text: hostelText,
  });

  await UniversityInfoSettings.findOneAndUpdate(
    { key: 'default' },
    {
      contactBlock: 'TEST CONTACT BLOCK\nAdmissions Office: +91 90000 00000\nEmail: test-contact@example.edu',
      disclaimer: `${DEFAULT_DISCLAIMER} (Acceptance test data.)`,
      updatedBy: admin._id,
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  const approvedCount = await UniversityInfo.countDocuments({ approved: true, status: 'approved' });

  console.log(JSON.stringify({
    adminId: admin._id.toString(),
    studentId: student._id.toString(),
    admissionsId: admissions.document._id.toString(),
    admissionsChunks: admissions.chunkCount,
    hostelId: hostel.document._id.toString(),
    hostelChunks: hostel.chunkCount,
    approvedCount,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
