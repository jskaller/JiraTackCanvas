/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Node 24 ships a global WebSocket, so the harness needs no packages (AGENTS.md:
 * no new dependencies without approval).
 */

export function connect(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${message.error.message || 'CDP error'} ${JSON.stringify(message.error.data || '')}`));
        else entry.resolve(message.result);
      }
    });

    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${webSocketDebuggerUrl}`)));

    socket.addEventListener('open', () => {
      const send = (method, params) => new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params: params || {} }));
      });

      const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails) {
          const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
          throw new Error(detail || result.exceptionDetails.text || 'evaluation failed');
        }
        return result.result ? result.result.value : undefined;
      };

      resolve({ send, evaluate, close: () => socket.close() });
    });
  });
}

export async function version(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`devtools endpoint not ready (${res.status})`);
  return res.json();
}

export async function targets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`devtools list failed (${res.status})`);
  return res.json();
}

export async function newTarget(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open target (${res.status})`);
  return res.json();
}

export async function waitFor(check, { timeout = 20000, interval = 200 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) return null;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
