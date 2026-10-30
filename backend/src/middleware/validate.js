import { ZodError } from 'zod';

const validationError = (res, error) => res.status(400).json({
  error: 'Validation failed',
  details: error.errors.map(e => ({
    field: e.path.join('.'),
    message: e.message,
  })),
});

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
