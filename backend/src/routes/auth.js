import { z } from 'zod';
import express from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import {
  requireAuth,
  generateToken,
  validate,
  loginRateLimit,
  registerRateLimit,
  getLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
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

router.get('/me', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: publicUser(req.user) });
});

export default router;
