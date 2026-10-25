export function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return input.trim(); }
  u.hash = '';
  const trackingParams = [
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'fbclid','gclid','mc_cid','mc_eid','_hsenc','_hsmi','ref'
  ];
  for (const p of trackingParams) u.searchParams.delete(p);
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  const sorted = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
  u.search = sorted.length
    ? '?' + sorted.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  return u.toString();
}
