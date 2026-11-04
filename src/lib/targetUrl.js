import { canonicalUrl } from '../shared/urlNormalize.js';

/**
 * Resolve the canvas target URL (D43).
 *
 * A reviewer typing `montefioreeinstein.org` means that page, not the example
 * placeholder. Only an empty field falls back to https://example.com; anything
 * provided that is not http(s) is an error instead of a silent substitution.
 */
export function resolveTargetUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: true, url: 'https://example.com', provided: false };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\//i.test(withScheme)) {
    return { ok: false, message: 'targetUrl must be an http(s) URL.' };
  }
  try {
    return { ok: true, url: canonicalUrl(withScheme), provided: true };
  } catch (e) {
    return { ok: false, message: 'targetUrl is not a valid URL.' };
  }
}

/**
 * The URL a canvas should be created with. An explicit target wins; otherwise a
 * URL-shaped canvas name is used (people type the page URL into the name), and
 * only a genuinely empty pair falls back to https://example.com.
 */
export function resolveCanvasTarget({ canvasName, targetUrl } = {}) {
  const explicit = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  const name = typeof canvasName === 'string' ? canvasName.trim() : '';
  const nameLooksLikeUrl = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(name);
  return resolveTargetUrl(explicit || (nameLooksLikeUrl ? name : ''));
}
