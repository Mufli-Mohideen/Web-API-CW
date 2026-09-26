/**
 * The single error contract used across the whole API:
 *   { "error": { "code": "...", "message": "...", "details": [...] } }
 */
export interface ErrorDetail {
  field?: string;
  issue: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  static badRequest(message: string, details: ErrorDetail[] = []) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication is required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(resource: string) {
    return new ApiError(404, 'NOT_FOUND', `${resource} not found`);
  }
  static conflict(message: string, details: ErrorDetail[] = []) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
}
