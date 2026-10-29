/**
 * Returns an absolute http(s) URL, or null. Used at every place a stored or
 * user-provided URL becomes an href / location assignment, so a `javascript:`
 * (or `data:`) value can never execute in the Jira page or the host page.
 */
export function toSafeHttpUrl(value, base) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed, base || undefined);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

export function isSafeHttpUrl(value, base) {
  return toSafeHttpUrl(value, base) !== null;
}
