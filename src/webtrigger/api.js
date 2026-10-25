import { errorResponse, STATUS_BY_CODE } from '../lib/errors.js';
import { authenticate } from './middleware/auth.js';
import { exchangeToken } from './actions/exchangeToken.js';
import { getPinsForCanvasAndUrl } from './actions/getPins.js';
import { createIssue } from './actions/createIssue.js';
import { getTransitions } from './actions/transitions.js';
import { updateIssue } from './actions/updateIssue.js';
import { searchUsers } from './actions/searchUsers.js';

const JSON_HEADERS = { 'Content-Type': ['application/json'] };

function envelope(result) {
  if (result && result.ok === true) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(result),
    };
  }
  let error;
  if (result && result.error && result.error.code) {
    error = result.error;
  } else if (result && result.code) {
    error = result;
  } else {
    error = { code: 'INTERNAL', message: 'Unknown error', details: null };
  }
  const statusCode = STATUS_BY_CODE[error.code] || 500;
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({ ok: false, error }),
  };
}

export const handler = async (req, context) => {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    return envelope(errorResponse('BAD_REQUEST', 'Only POST is supported.'));
  }

  let body;
  try {
    body = JSON.parse((req && req.body) || '{}');
  } catch (e) {
    return envelope(errorResponse('BAD_REQUEST', 'Request body must be valid JSON.'));
  }

  const action = body && body.action;
  const payload = (body && body.payload) || {};

  if (typeof action !== 'string' || action.length === 0) {
    return envelope(errorResponse('BAD_REQUEST', 'Missing action.'));
  }

  try {
    if (action === 'exchangeToken') {
      return envelope(await exchangeToken(payload));
    }

    if (action === 'getPinsForCanvasAndUrl') {
      const auth = await authenticate(req, context, ['create', 'view']);
      if (!auth.ok) return envelope(auth);
      return envelope(await getPinsForCanvasAndUrl(payload, auth.claims));
    }

    if (action === 'createIssue') {
      const auth = await authenticate(req, context, ['create']);
      if (!auth.ok) return envelope(auth);
      return envelope(await createIssue(payload, auth.claims));
    }

    if (action === 'getTransitions') {
      const auth = await authenticate(req, context, ['create', 'view']);
      if (!auth.ok) return envelope(auth);
      return envelope(await getTransitions(payload, auth.claims));
    }

    if (action === 'updateIssue') {
      const auth = await authenticate(req, context, ['create']);
      if (!auth.ok) return envelope(auth);
      return envelope(await updateIssue(payload, auth.claims));
    }

    if (action === 'searchUsers') {
      const auth = await authenticate(req, context, ['create']);
      if (!auth.ok) return envelope(auth);
      return envelope(await searchUsers(payload, auth.claims));
    }

    return envelope(errorResponse('BAD_REQUEST', `Unknown action: ${action}`));
  } catch (e) {
    console.error('[JiraTack] Webtrigger error:', e);
    return envelope(errorResponse('INTERNAL', e && e.message ? e.message : String(e)));
  }
};
