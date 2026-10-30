export const DEEP_LINK_PARAMS = ['jiratack_ticket', 'jiratack_canvas'];

/**
 * Page identity is decided in three steps, deliberately in this order:
 *   1. canonical    — scheme/host case, fragment, deep-link params, param order
 *   2. drop noise   — known trackers, cache-busters, version stamps, random values
 *   3. keep-list    — names whose long values are meaningful, never dropped by shape
 *
 * The keep-list exists because a hash-shaped value under `sku`, `id` or `product`
 * identifies content, not a session. Dropping it would merge two real pages.
 */
const TRACKING_NAMES = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'twclid',
  'li_fat_id', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'vero_id',
  'wickedid', 'yclid', 's_cid', 'spm', 'ref', 'ref_src',
]);

const CACHE_NAMES = new Set([
  '_', 'cb', 'cachebust', 'nocache', 'rnd', 'random', 't', 'ts', 'timestamp', 'time',
]);

const VERSION_NAMES = new Set(['v', 'ver', 'version']);

const KEEP_NAMES = new Set([
  'id', 'page', 'p', 'q', 'query', 'search', 'filter', 'sort', 'view', 'tab',
  'lang', 'locale', 'sku', 'product', 'slug', 'path', 'file', 'doc', 'issue',
  'key', 'project',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/i;
const EPOCH_RE = /^\d{10,13}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const SEMVER_RE = /^\d+(?:\.\d+)*$/;

function looksRandom(value) {
  if (!value) return false;
  if (UUID_RE.test(value)) return true;
  if (HEX_RE.test(value)) return true;
  if (EPOCH_RE.test(value)) return true;
  return value.length >= 16
    && TOKEN_RE.test(value)
    && /[A-Za-z]/.test(value)
    && /\d/.test(value);
}

function parse(input) {
  try {
    return new URL(input);
  } catch (e) {
    return null;
  }
}

function writeQuery(url, entries) {
  const sorted = entries.slice().sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) return aValue.localeCompare(bValue);
    return aKey.localeCompare(bKey);
  });
  const params = new URLSearchParams();
  sorted.forEach(([key, value]) => params.append(key, value));
  const serialised = params.toString();
  url.search = serialised ? `?${serialised}` : '';
}

function baseUrl(input) {
  const url = parse(input);
  if (!url) return null;
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  for (const param of DEEP_LINK_PARAMS) url.searchParams.delete(param);
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url;
}

/** Removes only the deep-link params, keeping every other parameter as-is. */
export function stripDeepLinkParams(input) {
  if (!input) return '';
  const url = parse(input);
  if (!url) return String(input).trim();
  for (const param of DEEP_LINK_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

/** The URL as captured: fragment and deep-link params removed, everything else kept. */
export function canonicalUrl(input) {
  if (!input) return '';
  const url = baseUrl(input);
  if (!url) return String(input).trim();
  writeQuery(url, [...url.searchParams.entries()]);
  return url.toString();
}

/** The page identity used for matching: canonical, minus noise and per-visit values. */
export function normalizeUrl(input) {
  if (!input) return '';
  const url = baseUrl(input);
  if (!url) return String(input).trim();

  const kept = [...url.searchParams.entries()].filter(([key, value]) => {
    const name = key.toLowerCase();
    if (name.startsWith('utm_')) return false;
    if (TRACKING_NAMES.has(name)) return false;
    if (KEEP_NAMES.has(name)) return true;
    if (CACHE_NAMES.has(name)) return !looksRandom(value) && !/^\d+$/.test(value);
    if (VERSION_NAMES.has(name)) return !SEMVER_RE.test(value) && !looksRandom(value);
    return !looksRandom(value);
  });

  writeQuery(url, kept);
  return url.toString();
}

/** Origin and path only — "every variation of this page". */
export function pathOnlyUrl(input) {
  if (!input) return '';
  const url = baseUrl(input);
  if (!url) return String(input).trim();
  url.search = '';
  return url.toString();
}

/**
 * Modes (view-side, chosen by the reviewer):
 *   smart — the heuristic above (default)
 *   exact — same query parameters, order-insensitive
 *   path  — ignore the query entirely
 */
export function urlMatches(pinUrl, currentUrl, mode) {
  if (mode === 'all') return true;
  if (!pinUrl) return false;
  if (mode === 'path') {
    return pathOnlyUrl(pinUrl) === pathOnlyUrl(currentUrl);
  }
  if (mode === 'exact') {
    return canonicalUrl(pinUrl) === canonicalUrl(currentUrl);
  }
  return normalizeUrl(pinUrl) === normalizeUrl(currentUrl);
}

export function filterPinsByUrl(pins, currentUrl, mode) {
  if (mode === 'all') return Array.isArray(pins) ? pins.slice() : [];
  return (Array.isArray(pins) ? pins : []).filter((pin) => urlMatches(pin && pin.url, currentUrl, mode));
}

/** How many pins each mode would show, so the sidebar can offer an informed choice. */
export function countPinsByUrl(pins, currentUrl) {
  return {
    smart: filterPinsByUrl(pins, currentUrl, 'smart').length,
    exact: filterPinsByUrl(pins, currentUrl, 'exact').length,
    path: filterPinsByUrl(pins, currentUrl, 'path').length,
  };
}
