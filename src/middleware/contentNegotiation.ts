import type { RequestHandler } from 'express';
import { ApiError } from '../errors/ApiError';

export const JSON_BODY_TYPES = ['application/json', 'application/merge-patch+json'];

/** JSON is the only representation. Reject Accept headers that exclude it (406). */
export const requireJsonAccept: RequestHandler = (req, _res, next) => {
  if (req.accepts('application/json')) return next();
  next(new ApiError(406, 'NOT_ACCEPTABLE', 'This API only produces application/json', [
    { field: 'Accept', issue: `cannot satisfy: ${req.get('Accept')}` },
  ]));
};

/** Requests carrying a body must send it as JSON (415). PATCH also accepts JSON Merge Patch. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && req.get('Content-Type');
  if (!hasBody || req.is(JSON_BODY_TYPES)) return next();
  next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json', [
    { field: 'Content-Type', issue: `unsupported media type: ${req.get('Content-Type')}` },
  ]));
};
