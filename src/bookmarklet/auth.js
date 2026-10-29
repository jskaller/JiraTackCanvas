const SESSION_KEY_PREFIX = 'jiratack_jwt_';

/**
 * Sync storage adapter used by the bookmarklet. A Chrome extension can pass
 * its own object with the same shape (getItem/setItem/removeItem/keys), which
 * is the only browser dependency in the auth flow.
 */
export function createBrowserSessionStorage(target) {
  const storage = target
    || (typeof window !== 'undefined' ? window.sessionStorage : null);

  return {
    getItem(key) {
      try {
        return storage ? storage.getItem(key) : null;
      } catch (e) {
        return null;
      }
    },
    setItem(key, value) {
      try {
        if (storage) storage.setItem(key, value);
      } catch (e) {
        // storage may be unavailable; in-memory session still works
      }
    },
    removeItem(key) {
      try {
        if (storage) storage.removeItem(key);
      } catch (e) {
        // ignore
      }
    },
    keys(prefix) {
      const out = [];
      try {
        if (!storage) return out;
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && key.startsWith(prefix)) out.push(key);
        }
      } catch (e) {
        // ignore
      }
      return out;
    },
  };
}

/**
 * DOM-free session manager: exchange, cache, refresh, clear.
 * `storage` defaults to sessionStorage but is injectable for the extension.
 */
export function createSessionManager(storage) {
  const store = storage || createBrowserSessionStorage();

  function sessionKey(canvasId) {
    return `${SESSION_KEY_PREFIX}${canvasId}`;
  }

  function read(canvasId) {
    try {
      const raw = store.getItem(sessionKey(canvasId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.jwt || !parsed.expiresAt) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function write(canvasId, session) {
    try {
      store.setItem(sessionKey(canvasId), JSON.stringify(session));
    } catch (e) {
      // in-memory session only
    }
  }

  function clear(canvasId) {
    if (canvasId) {
      store.removeItem(sessionKey(canvasId));
      return;
    }
    store.keys(SESSION_KEY_PREFIX).forEach((key) => store.removeItem(key));
  }

  async function exchange(config, options = {}) {
    const canvasId = config.canvasId;
    if (!options.force) {
      const cached = read(canvasId);
      if (
        cached
        && cached.expiresAt > Date.now()
        && Object.prototype.hasOwnProperty.call(cached, 'displayName')
        && Object.prototype.hasOwnProperty.call(cached, 'isAdmin')
      ) {
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
      permittedCanvases: data.permittedCanvases || null,
      issuer: data.issuer || null,
      jiraBaseUrl: data.jiraBaseUrl || null,
      displayName: data.displayName || null,
      isAdmin: data.isAdmin === true,
    };
    write(canvasId, session);
    return session;
  }

  return { read, write, clear, exchange };
}

const browserSessionManager = createSessionManager();

export const exchangeSession = browserSessionManager.exchange;
export const clearSession = browserSessionManager.clear;
