export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  LICENSE_INACTIVE: 'LICENSE_INACTIVE',
  NO_CANVAS_ACCESS: 'NO_CANVAS_ACCESS',
  NOT_FOUND: 'NOT_FOUND',
  PROJECT_DISABLED: 'PROJECT_DISABLED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL: 'INTERNAL',
};

export function errorResponse(code, message, details = null) {
  return { code, message, details };
}

export function errorResult(code, message, details = null) {
  return { ok: false, error: errorResponse(code, message, details) };
}

export const STATUS_BY_CODE = {
  BAD_REQUEST: 400,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  INSUFFICIENT_SCOPE: 403,
  LICENSE_INACTIVE: 403,
  NO_CANVAS_ACCESS: 403,
  NOT_FOUND: 404,
  PROJECT_DISABLED: 422,
  VALIDATION_ERROR: 422,
  INTERNAL: 500,
};

export function successResponse(data) {
  return { ok: true, data };
}
