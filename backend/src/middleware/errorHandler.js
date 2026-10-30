import multer from 'multer';

/**
 * Central error handler.
 *
 * Never leaks stack traces, file paths or library details to clients. Full
 * details are logged server-side only.
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Uploaded file is too large' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    return res.status(400).json({ error: 'Invalid file upload' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body' });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Invalid request data' });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  const status = err.status || err.statusCode || 500;

  // Only expose messages that the application explicitly marked as client-safe
  // (4xx AppErrors). Server errors stay generic.
  const message = status >= 500
    ? 'Internal server error'
    : (err.message || 'Request failed');

  res.status(status).json({ error: message });
};

export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
    this.name = 'AppError';
  }
}
