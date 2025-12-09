import type { Request, Response, NextFunction } from 'express';

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
  stack?: string;
}

/**
 * Custom API error class
 */
export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'APIError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error handling middleware
 *
 * Catches all errors thrown in route handlers and converts them
 * to proper JSON error responses with appropriate status codes.
 */
export function errorHandler(
  err: Error | APIError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log the error
  console.error('API Error:', err);

  // Determine status code
  const statusCode = err instanceof APIError ? err.statusCode : 500;

  // Build error response
  const errorResponse: ErrorResponse = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
  };

  // Add details if available
  if (err instanceof APIError && err.details) {
    errorResponse.details = err.details;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NotFound',
    message: `Route ${req.method} ${req.path} not found`,
  });
}
