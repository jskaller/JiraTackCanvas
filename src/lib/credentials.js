import crypto from 'crypto';
import { kvs, kvsGet } from './kvs.js';
import {
  buildCredentialRecord,
  credentialIndexKey,
  credentialKey,
  hashToken,
  pairingAllowed,
  remainingTtlSeconds,
} from './credentialsModel.js';

/**
 * Credential tokens (S2).
 *
 * An invite token is an identity-bearing bearer that can be forwarded. Each
 * pairing mints an independent credential so forwardees do not share one
 * secret, and revoking the invite invalidates every credential derived from it.
 *
 * Writes go through `kvs.transact()` so the parent's pairing counter, the
 * credential and the reverse-index row land together. The cap check itself is
 * a read outside the transaction: a burst of simultaneous pairings of the same
 * link can exceed 5 by the number of concurrent opens. That is acceptable for
 * a blast-radius cap (it is not a billing meter) and is recorded in D24.
 */

const INVITE_PREFIX = 'canvasTokens:';

export async function mintCredential({ inviteToken, deviceLabel, now = Date.now() }) {
  if (typeof inviteToken !== 'string' || inviteToken.length === 0) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invite token is required.' };
  }

  const parentToken = inviteToken;
  const parentKey = `${INVITE_PREFIX}${parentToken}`;
  const parent = await kvsGet(parentKey);

  if (!parent) {
    return { ok: false, code: 'TOKEN_INVALID', message: 'This invite link is not valid. Ask for a new one.' };
  }
  if (parent.scope !== 'guest_create') {
    return { ok: false, code: 'TOKEN_INVALID', message: 'This link is not a reviewer invite.' };
  }
  if (parent.expiresAt && parent.expiresAt < now) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: 'This invite link has expired. Ask for a new one.' };
  }

  const allowed = pairingAllowed(parent);
  if (!allowed.ok) return allowed;

  const raw = crypto.randomBytes(32).toString('hex');
  const credential = buildCredentialRecord({ raw, parent, parentToken, deviceLabel, now });
  const ttl = { value: remainingTtlSeconds(parent.expiresAt || now, now), unit: 'SECONDS' };

  try {
    await kvs
      .transact()
      .set(parentKey, { ...parent, pairingCount: allowed.used + 1 }, undefined, { ttl })
      .set(credentialKey(credential.credentialId), credential, undefined, { ttl })
      .set(
        credentialIndexKey(credential.parentRef, credential.credentialId),
        { credentialId: credential.credentialId, issuedAt: credential.issuedAt },
        undefined,
        { ttl },
      )
      .execute();
  } catch (e) {
    console.error('[JiraTack] Credential mint failed:', e && e.message ? e.message : e);
    return { ok: false, code: 'INTERNAL', message: 'Could not create a pairing for this link.' };
  }

  return { ok: true, token: raw, credential };
}

/**
 * Resolves a raw credential token to its record and parent invite.
 * The parent is authoritative for revocation and expiry: deleting or revoking
 * the invite invalidates every credential derived from it, without a fan-out.
 */
export async function authenticateCredential(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const credential = await kvsGet(credentialKey(hashToken(raw)));
  if (!credential) return null;

  if (credential.state !== 'active') {
    return { ok: false, code: 'TOKEN_INVALID', message: 'This pairing has been revoked.' };
  }
  if (credential.expiresAt && credential.expiresAt < now) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: 'This pairing has expired.' };
  }

  const parent = await kvsGet(`${INVITE_PREFIX}${credential.parentToken}`);
  if (!parent) {
    return { ok: false, code: 'TOKEN_INVALID', message: 'The invite behind this pairing is no longer valid.' };
  }
  if (parent.revoked) {
    return { ok: false, code: 'TOKEN_INVALID', message: 'The invite behind this pairing has been revoked.' };
  }
  if (parent.expiresAt && parent.expiresAt < now) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: 'The invite behind this pairing has expired.' };
  }

  // Best-effort usage stamp; never blocks the exchange.
  try {
    await kvs.set(credentialKey(credential.credentialId), { ...credential, lastUsedAt: now }, {
      ttl: { value: remainingTtlSeconds(credential.expiresAt || now, now), unit: 'SECONDS' },
    });
  } catch (e) {
    // ignore
  }

  return { ok: true, credential, parent };
}

/** Attaches the reviewer binding to the credential on its first pin (D24). */
export async function markCredentialBinding(credentialId, bindingId) {
  if (typeof credentialId !== 'string' || typeof bindingId !== 'string') return false;
  try {
    const key = credentialKey(credentialId);
    const credential = await kvsGet(key);
    if (!credential) return false;
    await kvs.set(key, { ...credential, bindingId }, {
      ttl: { value: remainingTtlSeconds(credential.expiresAt || Date.now(), Date.now()), unit: 'SECONDS' },
    });
    return true;
  } catch (e) {
    console.error('[JiraTack] markCredentialBinding failed:', e && e.message ? e.message : e);
    return false;
  }
}
