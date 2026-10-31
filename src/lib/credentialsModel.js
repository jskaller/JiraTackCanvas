import crypto from 'crypto';

/**
 * Pure credential rules (S2). No KVS imports, so the arithmetic and the cap
 * logic are unit-testable.
 *
 * An invite token (guest token) can be paired up to MAX_PAIRINGS times. Each
 * pairing mints an independent credential carrying its own raw token; the raw
 * value is never stored, only its SHA-256.
 */

export const MAX_PAIRINGS = 5;
export const PAIRING_TTL_FLOOR_SECONDS = 60;

export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Short, non-reversible reference used in index keys and admin output. */
export function parentRefOf(raw) {
  return hashToken(raw).slice(0, 16);
}

export function remainingTtlSeconds(expiresAt, now) {
  const remaining = Math.ceil((Number(expiresAt) - Number(now)) / 1000);
  return Math.max(PAIRING_TTL_FLOOR_SECONDS, remaining);
}

export function pairingAllowed(parent) {
  if (!parent) return { ok: false, code: 'TOKEN_INVALID', message: 'Invite token not found.' };
  if (parent.revoked) return { ok: false, code: 'TOKEN_INVALID', message: 'Invite token has been revoked.' };
  const used = Number(parent.pairingCount) || 0;
  if (used >= MAX_PAIRINGS) {
    return {
      ok: false,
      code: 'PAIRING_LIMIT',
      message: `This link has already been paired ${MAX_PAIRINGS} times. Ask your delegator for a new link.`,
    };
  }
  return { ok: true, used };
}

export function buildCredentialRecord({ raw, parent, parentToken, deviceLabel, now }) {
  return {
    credentialId: hashToken(raw),
    parentToken,
    parentRef: parentRefOf(parentToken),
    pairingId: crypto.randomUUID(),
    deviceLabel: deviceLabel || null,
    bindingId: null,
    state: 'active',
    issuedAt: now,
    lastUsedAt: null,
    expiresAt: parent && parent.expiresAt ? parent.expiresAt : null,
  };
}

export function credentialIndexKey(parentRef, credentialId) {
  return `credentialsByParent:${parentRef}:${credentialId}`;
}

export function credentialKey(credentialId) {
  return `credentialTokens:${credentialId}`;
}
