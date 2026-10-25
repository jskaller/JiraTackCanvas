import { getAppContext } from '@forge/api';
import { errorResponse } from '../../lib/errors.js';
import { verifySessionJwt } from '../../lib/tokens.js';

function getHeader(headers, name) {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return null;
}

function expectedAudience(req, context) {
  try {
    const ari = getAppContext().installationAri;
    if (ari) return ari.toString();
  } catch (e) {
    // fall through
  }
  const ctx = (req && req.context) || context;
  return (ctx && (ctx.installContext || ctx.installationId)) || null;
}

export async function authenticate(req, context, allowedScopes) {
  const authHeader = getHeader(req.headers, 'authorization');
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return { ok: false, error: errorResponse('TOKEN_INVALID', 'Missing or malformed Authorization header.') };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  let claims;
  try {
    claims = await verifySessionJwt(token);
  } catch (e) {
    if (e && (e.name === 'TokenExpiredError' || e.message === 'jwt expired')) {
      return { ok: false, error: errorResponse('TOKEN_EXPIRED', 'Session token has expired.') };
    }
    return { ok: false, error: errorResponse('TOKEN_INVALID', 'Session token is invalid.') };
  }

  const expectedAud = expectedAudience(req, context);
  if (expectedAud && claims.aud && claims.aud !== expectedAud) {
    return { ok: false, error: errorResponse('TOKEN_INVALID', 'Session token audience mismatch.') };
  }

  if (Array.isArray(allowedScopes) && allowedScopes.length > 0 && !allowedScopes.includes(claims.scope)) {
    return { ok: false, error: errorResponse('INSUFFICIENT_SCOPE', 'Token scope does not allow this action.') };
  }

  return { ok: true, claims };
}
