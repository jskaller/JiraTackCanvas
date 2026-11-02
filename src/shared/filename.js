/**
 * Filenames travel into a multipart `Content-Disposition` header on the way to
 * Jira, so quotes, separators and control characters are a header-injection
 * risk, not a cosmetic one. Kept pure and separate so it can be tested without
 * loading the Forge runtime.
 */
export function sanitiseFilename(value, mimeType) {
  const subtype = String(mimeType || '').split('/')[1] || '';
  const fallbackExt = subtype.split('+')[0] || 'bin';
  const base = typeof value === 'string' ? value : '';
  const cleaned = base
    .replace(/[\r\n\0]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/["']/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || `jiratack-upload.${fallbackExt}`;
}
