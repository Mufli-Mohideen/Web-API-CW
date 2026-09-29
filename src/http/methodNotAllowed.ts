import type { RequestHandler } from 'express';
import { ApiError } from '../errors/ApiError';

/** 405 with an Allow header for methods a resource does not support (e.g. PUT on an append-only reading). */
export function methodNotAllowed(...allowed: string[]): RequestHandler {
  return (req, res, next) => {
    res.set('Allow', allowed.join(', '));
    next(new ApiError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not supported on this resource`, [
      { field: 'method', issue: `allowed methods: ${allowed.join(', ')}` },
    ]));
  };
}
