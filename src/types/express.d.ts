import type { RequestAccessContext } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      accessContext?: RequestAccessContext;
    }
  }
}

export {};