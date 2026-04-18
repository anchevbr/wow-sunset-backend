import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiResponse, RequestAccessContext } from '../models/types';

const INTERNAL_SECRET_HEADER = 'x-internal-app-secret';
const PUBLIC_API_KEY_HEADER = 'x-api-key';

const isPublicHealthPath = (path: string): boolean => path === '/health' || path.startsWith('/health/');

const secureEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getBearerToken = (headerValue?: string): string | undefined => {
  if (!headerValue) {
    return undefined;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
};

const fingerprintKey = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

const buildAnonymousContext = (req: Request): RequestAccessContext => ({
  type: 'anonymous',
  identifier: `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
  rateLimitBypass: false,
});

export const resolveRequestAccessContext = (req: Request): RequestAccessContext => {
  const internalSecret = req.get(INTERNAL_SECRET_HEADER);
  if (config.auth.internalAppSecret && internalSecret && secureEquals(internalSecret, config.auth.internalAppSecret)) {
    return {
      type: 'internal',
      identifier: 'internal-app',
      rateLimitBypass: true,
    };
  }

  const publicApiKey = req.get(PUBLIC_API_KEY_HEADER) ?? getBearerToken(req.get('authorization'));
  if (publicApiKey) {
    const matchedKey = config.auth.publicApiKeys.find((key) => secureEquals(publicApiKey, key));

    if (matchedKey) {
      return {
        type: 'public',
        identifier: `public:${fingerprintKey(matchedKey)}`,
        rateLimitBypass: false,
      };
    }
  }

  return buildAnonymousContext(req);
};

export const attachRequestAccessContext = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  req.accessContext = resolveRequestAccessContext(req);
  next();
};

export const apiAccessGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (isPublicHealthPath(req.path)) {
    next();
    return;
  }

  const accessContext = req.accessContext ?? buildAnonymousContext(req);
  if (accessContext.type === 'internal' || accessContext.type === 'public' || config.auth.allowAnonymousApi) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: {
      code: 'AUTH_REQUIRED',
      message: 'API authentication is required for this endpoint',
    },
  } as ApiResponse);
};

export const requireInternalAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (req.accessContext?.type === 'internal') {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: {
      code: 'INTERNAL_ACCESS_REQUIRED',
      message: 'This endpoint is only available to the first-party application backend',
    },
  } as ApiResponse);
};

export const rateLimitSkip = (req: Request): boolean => req.accessContext?.rateLimitBypass ?? false;

export const rateLimitKeyGenerator = (req: Request): string =>
  req.accessContext?.identifier ?? buildAnonymousContext(req).identifier;