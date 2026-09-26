import type { RequestHandler } from 'express';
import { ApiError } from '../errors/ApiError';

/** JSON is the only representation. Reject Accept headers that exclude it (406). */
export const requireJsonAccept: RequestHandler = (req, _res, next) => {
  if (req.accepts('application/json')) return next();
  next(new ApiError(406, 'NOT_ACCEPTABLE', 'This API only produces application/json', [
    { field: 'Accept', issue: `Unsupported media type: ${req.get('Accept')}` },
  ]));
};

/** Requests carrying a body must send it as JSON (415). */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && Number(req.get('Content-Length') ?? 0) > 0;
  if (!hasBody || req.is('application/json')) return next();
  next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json', [
    { field: 'Content-Type', issue: `Unsupported media type: ${req.get('Content-Type')}` },
  ]));
};
