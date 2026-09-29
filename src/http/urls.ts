import type { Request } from 'express';

/** Absolute URL of an API path on this deployment (used for Location headers). */
export function absoluteUrl(req: Request, path: string): string {
  return `${req.protocol}://${req.get('host')}/api/v1${path}`;
}
