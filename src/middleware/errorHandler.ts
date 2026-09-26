import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../errors/ApiError';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `No resource matches ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.toBody());
    return;
  }

  // Malformed JSON body rejected by express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json(new ApiError(400, 'MALFORMED_JSON', 'Request body is not valid JSON').toBody());
    return;
  }

  console.error(err);
  res.status(500).json(new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred').toBody());
};
