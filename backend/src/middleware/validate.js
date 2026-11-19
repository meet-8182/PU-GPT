import { ZodError } from 'zod';

const validationError = (res, error) => {
  // Support both zod v3 (error.errors) and v4 (error.issues) formats
  const issues = Array.isArray(error.errors) ? error.errors 
    : Array.isArray(error.issues) ? error.issues 
    : [];
  return res.status(400).json({
    error: 'Validation failed',
    details: issues.map(e => ({
      field: Array.isArray(e.path) ? e.path.join('.') : 'unknown',
      message: e.message || 'Invalid value',
    })),
  });
};

export const validate = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(res, error);
      }
      next(error);
    }
  };
};

export const validateQuery = (schema) => {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(res, error);
      }
      next(error);
    }
  };
};

export const validateParams = (schema) => {
  return (req, res, next) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(res, error);
      }
      next(error);
    }
  };
};
