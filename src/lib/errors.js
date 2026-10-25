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
  return { ok: false, error: { code, message, details } };
}

export function successResponse(data) {
  return { ok: true, data };
}
