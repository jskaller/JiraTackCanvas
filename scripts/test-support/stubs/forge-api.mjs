/**
 * In-memory `@forge/api` for resolver tests.
 *
 * Requests are dispatched to handlers registered per test. Every call is
 * recorded, and a call with no handler answers 404 and is listed by
 * `unmatchedRequests()` so a test can prove its happy path never fell through
 * to a silent default.
 */

const calls = [];
const handlers = [];

export function resetApi() {
  calls.length = 0;
  handlers.length = 0;
}

export function apiCalls() {
  return calls.map((call) => ({ ...call }));
}

export function unmatchedRequests() {
  return calls.filter((call) => !call.matched).map((call) => `${call.as} ${call.method} ${call.path}`);
}

/**
 * Register a response. `match` receives ({ as, method, path, options, body })
 * and returns true when the handler should answer.
 */
export function onRequest(match, respond) {
  handlers.push({ match, respond });
}

/** Shorthand: "any request whose path contains this text". */
export function onPath(includes, respond, options = {}) {
  onRequest((request) => {
    if (options.method && request.method !== options.method) return false;
    if (options.as && request.as !== options.as) return false;
    return request.path.includes(includes);
  }, respond);
}

export function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
    async text() {
      return text;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    },
  };
}

function pathOf(router) {
  if (typeof router === 'string') return router;
  if (router && typeof router.value === 'string') return router.value;
  return String(router);
}

export function route(strings, ...values) {
  let out = '';
  strings.forEach((chunk, index) => {
    out += chunk;
    if (index < values.length) out += String(values[index]);
  });
  return out;
}

async function requestJira(as, router, options = {}) {
  const path = pathOf(router);
  const method = (options.method || 'GET').toUpperCase();
  let body = null;
  if (typeof options.body === 'string') {
    try {
      body = JSON.parse(options.body);
    } catch (e) {
      body = options.body;
    }
  }

  const record = { as, method, path, options, body, matched: false };
  calls.push(record);

  for (const handler of handlers) {
    if (handler.match(record)) {
      record.matched = true;
      return handler.respond(record);
    }
  }

  return jsonResponse(404, { errorMessages: [`No stub for ${method} ${path}`] });
}

function requester(as) {
  return {
    requestJira: (router, options) => requestJira(as, router, options),
    async requestConfluence(router) {
      return jsonResponse(404, { errorMessages: [`No stub for Confluence ${pathOf(router)}`] });
    },
  };
}

export const api = {
  asApp: () => requester('app'),
  asUser: () => requester('user'),
  fetch: async (url) => jsonResponse(404, { errorMessages: [`No stub for fetch ${url}`] }),
};

export function getAppContext() {
  return { installContext: 'ari:cloud:ecosystem::installation/stub-installation' };
}

export const webTrigger = {
  async getUrl(moduleKey) {
    return `https://stub.invalid/${moduleKey}`;
  },
};

export default api;
