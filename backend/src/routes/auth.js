import { z } from 'zod';
import express from 'express';
import bcrypt from 'bcryptjs';
import { User, Department } from '../models/index.js';
import {
  requireAuth,
  generateToken,
  validate,
  loginRateLimit,
  registerRateLimit,
  getLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
  AppError,
} from '../middleware/index.js';

const router = express.Router();

// Dummy hash (cost 12) used to keep login timing constant for unknown accounts.
const DUMMY_PASSWORD_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

// Self-registration is student-only. Teacher/admin accounts are created by an
// administrator through /api/admin/teachers or the seed script.
const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: z.literal('student').optional(),
  department: z.string().max(100).optional(),
  subjects: z.array(z.string().max(100)).max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  department: user.department,
  subjects: user.subjects,
  college: user.college,
  program: user.program,
  fieldCategory: user.fieldCategory,
  field: user.field,
  semester: user.semester,
  memoryEnabled: user.memoryEnabled,
});

router.post('/register', registerRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, department, subjects } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash: password,
      role: 'student',
      department,
      subjects: subjects || [],
    });

    const token = generateToken(user._id);

    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      user: publicUser(user),
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', loginRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    const lockout = getLoginLockout(email);
    if (lockout.locked) {
      res.set('Retry-After', String(lockout.retryAfter));
      return res.status(429).json({
        error: 'Too many failed login attempts. Try again later.',
        retryAfter: lockout.retryAfter,
      });
    }

    const user = await User.findOne({ email });

    // Always perform a bcrypt comparison so response timing does not reveal
    // whether the account exists.
    const isMatch = await bcrypt.compare(
      password,
      user ? user.passwordHash : DUMMY_PASSWORD_HASH
    );

    if (!user || !isMatch) {
      recordLoginFailure(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearLoginFailures(email);
    const token = generateToken(user._id);

    res.set('Cache-Control', 'no-store');
    res.json({
      user: publicUser(user),
      token,
    });
  } catch (error) {
    next(error);
  }
});

const profileSchema = z.object({
  department: z.string().trim().max(100).optional(),
  semester: z.string().trim().max(20).optional(),
  college: z.string().trim().max(200).optional(),
  program: z.enum(['diploma', 'btech', 'mtech']).optional(),
  fieldCategory: z.string().trim().max(100).optional(),
  field: z.string().trim().max(100).optional(),
}).strict();

// Departments available to the signed-in student. Reuses the Department model
// and values already assigned to users; no separate department store.
router.get('/departments', requireAuth, async (req, res, next) => {
  try {
    const [stored, assigned] = await Promise.all([
      Department.find().select('name').lean(),
      User.distinct('department', { department: { $nin: [null, ''] } }),
    ]);
    const departments = [...new Set([
      ...stored.map((department) => department.name),
      ...assigned,
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b));

    res.set('Cache-Control', 'no-store');
    res.json({ departments });
  } catch (error) {
    next(error);
  }
});

// Update the student's own profile fields. Only the allowlisted fields in
// profileSchema can be changed, and the account id always comes from the token.
router.patch('/profile', requireAuth, validate(profileSchema), async (req, res, next) => {
  try {
    const updates = {};
    for (const key of ['department', 'semester', 'college', 'program', 'fieldCategory', 'field']) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No profile fields provided', 400);
    }

    updates.updatedAt = new Date();
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!user) throw new AppError('User not found', 404);

    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: publicUser(req.user) });
});

export default router;
