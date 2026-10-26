const MAX_ENTRIES = 50;

let buffer = [];
let installed = false;
let originalError = null;
let originalWarn = null;

function stringifyArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch (e) {
    return String(arg);
  }
}

function stringifyArgs(args) {
  return args.map(stringifyArg).join(' ');
}

function extractSource() {
  try {
    const stack = new Error().stack;
    if (!stack) return null;
    const lines = stack.split('\n').slice(1);
    for (const line of lines) {
      if (line.includes('consoleProxy')) continue;
      return line.trim();
    }
    return null;
  } catch (e) {
    return null;
  }
}

function push(level, args) {
  buffer.push({
    level,
    message: stringifyArgs(args),
    source: extractSource(),
    timestamp: Date.now(),
  });
  while (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export function installConsoleProxy() {
  if (installed) return;
  installed = true;
  originalError = console.error;
  originalWarn = console.warn;

  console.error = function patchedError(...args) {
    push('error', args);
    originalError.apply(console, args);
  };

  console.warn = function patchedWarn(...args) {
    push('warn', args);
    originalWarn.apply(console, args);
  };
}

export function restoreConsoleProxy() {
  if (!installed) return;
  if (originalError) console.error = originalError;
  if (originalWarn) console.warn = originalWarn;
  installed = false;
}

export function getBufferSnapshot() {
  return buffer.slice();
}

export function clearConsoleBuffer() {
  buffer = [];
}

export function formatConsoleLog(entries) {
  return entries
    .map((entry) => {
      const suffix = entry.source ? ` (${entry.source})` : '';
      return `[${entry.level}] ${entry.message}${suffix}`;
    })
    .join('\n');
}
