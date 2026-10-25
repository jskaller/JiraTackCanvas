import { normalizeUrl } from '../shared/urlNormalize.js';

export async function getPins(config, session, canvasId, url) {
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.jwt}`,
    },
    body: JSON.stringify({
      action: 'getPinsForCanvasAndUrl',
      payload: { canvasId, url: normalizeUrl(url) },
    }),
  });

  let body;
  try {
    body = await response.json();
  } catch (e) {
    throw new Error('Pin query returned an invalid response.');
  }

  if (!body || body.ok !== true) {
    const err = new Error((body && body.error && body.error.message) || 'Pin query failed.');
    err.code = body && body.error && body.error.code;
    throw err;
  }

  return body.data;
}
