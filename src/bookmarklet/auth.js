const SESSION_KEY_PREFIX = 'jiratack_jwt_';

function sessionKey(canvasId) {
  return `${SESSION_KEY_PREFIX}${canvasId}`;
}

function readSession(canvasId) {
  try {
    const raw = sessionStorage.getItem(sessionKey(canvasId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.jwt || !parsed.expiresAt) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeSession(canvasId, session) {
  try {
    sessionStorage.setItem(sessionKey(canvasId), JSON.stringify(session));
  } catch (e) {
    // sessionStorage may be unavailable; continue with in-memory session only
  }
}

export function clearSession(canvasId) {
  try {
    if (canvasId) {
      sessionStorage.removeItem(sessionKey(canvasId));
      return;
    }
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SESSION_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch (e) {
    // ignore
  }
}

export async function exchangeSession(config, options = {}) {
  const canvasId = config.canvasId;
  if (!options.force) {
    const cached = readSession(canvasId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'exchangeToken',
      payload: { canvasToken: config.token },
    }),
  });

  let body;
  try {
    body = await response.json();
  } catch (e) {
    throw new Error('Token exchange returned an invalid response.');
  }

  if (!body || body.ok !== true) {
    const err = new Error((body && body.error && body.error.message) || 'Token exchange failed.');
    err.code = body && body.error && body.error.code;
    throw err;
  }

  const data = body.data;
  const session = {
    jwt: data.sessionJwt,
    expiresAt: data.expiresAt,
    scope: data.scope,
    permittedProjects: data.permittedProjects,
    jiraBaseUrl: data.jiraBaseUrl || null,
  };
  writeSession(canvasId, session);
  return session;
}
