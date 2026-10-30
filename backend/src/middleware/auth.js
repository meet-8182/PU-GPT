import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { User } from '../models/index.js';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Authentication middleware. Exported as both `requireAuth` (preferred, used by
 * the routers so the auth requirement is explicit at every mount point) and
 * `authenticate` for backwards compatibility.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const match = typeof authHeader === 'string' ? authHeader.match(BEARER_PATTERN) : null;

    if (!match) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(match[1], config.jwtSecret, {
      algorithms: ['HS256'],
    });

    if (!decoded?.userId || typeof decoded.userId !== 'string') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await User.findById(decoded.userId).select('-passwordHash');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return next(error);
  }
};

export const authenticate = requireAuth;

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

export const generateToken = (userId) => {
  return jwt.sign({ userId: String(userId) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
};
