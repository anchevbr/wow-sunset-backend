import type { Request, Response } from 'express';
import type { RequestAccessContext } from '../models/types';

const ORIGINAL_ENV = { ...process.env };

type RequestWithAccessContext = Request & { accessContext?: RequestAccessContext };

const createRequest = (
  path: string,
  headers: Record<string, string> = {},
  ip = '203.0.113.10'
): RequestWithAccessContext => {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    path,
    ip,
    socket: { remoteAddress: ip },
    get: (name: string) => normalizedHeaders[name.toLowerCase()],
  } as unknown as RequestWithAccessContext;
};

const createResponse = (): Response => {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return response as unknown as Response;
};

const loadAccessControl = (envOverrides: Record<string, string | undefined>) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  let loadedModule: typeof import('./access-control');

  jest.isolateModules(() => {
    loadedModule = jest.requireActual('./access-control') as typeof import('./access-control');
  });

  return loadedModule!;
};

describe('access control', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('identifies trusted first-party server traffic', async () => {
    const accessControl = loadAccessControl({
      INTERNAL_APP_SECRET: 'internal-secret',
      ALLOW_ANONYMOUS_API: 'false',
    });

    const context = accessControl.resolveRequestAccessContext(
      createRequest('/sunset/forecast', { 'x-internal-app-secret': 'internal-secret' })
    );

    expect(context).toEqual({
      type: 'internal',
      identifier: 'internal-app',
      rateLimitBypass: true,
    });
  });

  it('identifies public API key traffic without exposing the raw key', async () => {
    const accessControl = loadAccessControl({
      INTERNAL_APP_SECRET: 'internal-secret',
      PUBLIC_API_KEYS: 'free-key-1,free-key-2',
      ALLOW_ANONYMOUS_API: 'false',
    });

    const context = accessControl.resolveRequestAccessContext(
      createRequest('/sunset/forecast', { 'x-api-key': 'free-key-2' })
    );

    expect(context.type).toBe('public');
    expect(context.identifier).toMatch(/^public:[a-f0-9]{12}$/);
    expect(context.rateLimitBypass).toBe(false);
  });

  it('blocks anonymous access when anonymous API use is disabled', async () => {
    const accessControl = loadAccessControl({
      INTERNAL_APP_SECRET: 'internal-secret',
      ALLOW_ANONYMOUS_API: 'false',
    });
    const req = createRequest('/sunset/forecast');
    req.accessContext = accessControl.resolveRequestAccessContext(req);
    const res = createResponse();
    const next = jest.fn();

    accessControl.apiAccessGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      })
    );
  });

  it('keeps public health open even when anonymous access is disabled', async () => {
    const accessControl = loadAccessControl({
      INTERNAL_APP_SECRET: 'internal-secret',
      ALLOW_ANONYMOUS_API: 'false',
    });
    const req = createRequest('/health');
    req.accessContext = accessControl.resolveRequestAccessContext(req);
    const res = createResponse();
    const next = jest.fn();

    accessControl.apiAccessGuard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('keeps cache stats internal-only even when the route exists', async () => {
    const accessControl = loadAccessControl({
      INTERNAL_APP_SECRET: 'internal-secret',
      PUBLIC_API_KEYS: 'free-key-1',
      ALLOW_ANONYMOUS_API: 'false',
    });
    const req = createRequest('/health/cache', { 'x-api-key': 'free-key-1' });
    req.accessContext = accessControl.resolveRequestAccessContext(req);
    const res = createResponse();
    const next = jest.fn();

    accessControl.requireInternalAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INTERNAL_ACCESS_REQUIRED' }),
      })
    );
  });
});