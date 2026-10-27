export const DEEP_LINK_PARAMS = ['jiratack_ticket', 'jiratack_canvas'];

export function stripDeepLinkParams(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return String(input).trim(); }
  for (const param of DEEP_LINK_PARAMS) u.searchParams.delete(param);
  return u.toString();
}

export function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return input.trim(); }
  u.hash = '';
  u.search = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}
