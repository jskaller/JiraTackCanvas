import crypto from 'crypto';
import { kvsGet, kvsSet, kvsDelete } from './kvs.js';

/**
 * Flow 2/4 (D46): a guest credential a person can type.
 *
 * The invitation token is 64 hex characters — unusable in an email. A short
 * code carries the same authorisation, but only its SHA-256 is stored, so a
 * storage dump yields no usable guest credential. Lookup is by hash, so the
 * code itself is never a key.
 */

// No 0/O/1/I: a code that is read aloud must not be ambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PREFIX = 'JT';
const GROUPS = 2;
const GROUP_SIZE = 4;
const CODE_LENGTH = GROUPS * GROUP_SIZE;
const HASH_PREFIX = 'guestCodeHashes:';
const CODE_TTL_DAYS = 90;

export function formatGuestCode(body) {
  return `${PREFIX}-${body.slice(0, GROUP_SIZE)}-${body.slice(GROUP_SIZE)}`;
}

/**
 * Accepts `JT-4F9K-2XQ7`, `jt4f9k2xq7`, `4F9K2XQ7`, and anything else whose
 * letters and digits survive stripping. Returns '' when the shape is wrong, so
 * a malformed code never reaches the store.
 */
export function normaliseGuestCode(raw) {
  const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let body = compact;
  if (body.startsWith(PREFIX)) body = body.slice(PREFIX.length);
  if (body.length !== CODE_LENGTH) return '';
  for (const ch of body) {
    if (ALPHABET.indexOf(ch) === -1) return '';
  }
  return formatGuestCode(body);
}

export function generateGuestCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let body = '';
  for (let i = 0; i < bytes.length; i += 1) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return formatGuestCode(body);
}

export function hashGuestCode(code) {
  const normalised = normaliseGuestCode(code);
  if (!normalised) return '';
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

export function codeIndexKey(hash) {
  return `${HASH_PREFIX}${hash}`;
}

/**
 * Records the hash → invitation mapping. The invitation record remains the
 * source of truth: every exchange re-reads it, so revoke and pause take effect
 * immediately rather than when the code expires.
 */
export async function storeGuestCode(code, { inviteToken, installationId, expiresAt }) {
  const hash = hashGuestCode(code);
  if (!hash) throw new Error('A valid guest code is required.');
  await kvsSet(codeIndexKey(hash), {
    inviteToken,
    installationId: String(installationId || ''),
    expiresAt: Number(expiresAt) || 0,
  }, { ttl: { value: CODE_TTL_DAYS, unit: 'DAYS' } });
  return hash;
}

export async function resolveGuestCode(code) {
  const hash = hashGuestCode(code);
  if (!hash) return null;
  const row = await kvsGet(codeIndexKey(hash));
  if (!row || !row.inviteToken) return null;
  return { ...row, hash };
}

export async function deleteGuestCode(hash) {
  if (!hash) return;
  await kvsDelete(codeIndexKey(hash));
}

// A guessed code cannot be rate-limited by its own hash (the hash is random),
// so failures are counted per installation-hour into one bounded key.
const MISS_PREFIX = 'guestCodeMisses:';
const MISS_LIMIT = 1000;

function hourBucket(now) {
  return new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, '');
}

export async function guestCodeAttemptsLocked(now = Date.now()) {
  const current = await kvsGet(`${MISS_PREFIX}${hourBucket(now)}`);
  return Number(current || 0) >= MISS_LIMIT;
}

export async function noteGuestCodeMiss(now = Date.now()) {
  const key = `${MISS_PREFIX}${hourBucket(now)}`;
  const next = Number((await kvsGet(key)) || 0) + 1;
  if (next <= MISS_LIMIT) {
    await kvsSet(key, next, { ttl: { value: 2, unit: 'HOURS' } });
  }
  return next;
}

export const GUEST_CODE_TTL_DAYS = CODE_TTL_DAYS;
