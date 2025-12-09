import type { Request, Response, NextFunction } from 'express';

/**
 * Authentication middleware for bearer token validation
 *
 * Checks for bearer token in Authorization header and validates
 * against configured tokens. If no tokens are configured, all
 * requests are allowed (auth disabled).
 */
export function createAuthMiddleware(authTokens?: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If no tokens configured, auth is disabled
    if (!authTokens || authTokens.length === 0) {
      next();
      return;
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      });
      return;
    }

    // Validate bearer token format
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <token>',
      });
      return;
    }

    const token = match[1]!;

    // Validate token against configured tokens
    if (!authTokens.includes(token)) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authentication token',
      });
      return;
    }

    // Token is valid, proceed
    next();
  };
}
