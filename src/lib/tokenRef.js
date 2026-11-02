import crypto from 'crypto';

/** Non-reversible 12-hex reference used to identify a token in the UI. */
export function tokenReference(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}
