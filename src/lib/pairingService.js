import {
  MAX_PAIRINGS,
  buildPairingRecord,
  pairingIdFor,
  pairingIndexKey,
  pairingIndexPrefix,
  pairingKey,
  parentRefOf,
  remainingTtlSeconds,
} from './credentialsModel.js';

/**
 * Pairing service (S2), injectable and free of @forge imports so the CAS
 * behaviour is testable under node --test. Production wiring lives in
 * credentials.js.
 *
 * store shape: { get(key), set(key, value, options), query(prefix) → values[] }
 */
export function createPairingService(store) {
  async function getPairing(pairingId) {
    if (typeof pairingId !== 'string' || pairingId.length === 0) return null;
    return (await store.get(pairingKey(pairingId))) || null;
  }

  async function listPairingsForInvite(inviteTokenRef) {
    if (typeof inviteTokenRef !== 'string' || inviteTokenRef.length === 0) return [];
    return (await store.query(pairingIndexPrefix(inviteTokenRef))) || [];
  }

  async function countPairingsForInvite(inviteTokenRef) {
    return (await listPairingsForInvite(inviteTokenRef)).length;
  }

  async function touch(record, now) {
    try {
      await store.set(pairingKey(record.pairingId), { ...record, lastSeenAt: now });
    } catch (e) {
      // lastSeenAt is advisory; never block a session on it.
    }
  }

  /**
   * Resolve-or-create. Idempotent per (invite, installId): the CAS insert is
   * the gate, so two concurrent exchanges cannot both create a pairing.
   * The cap is read from the append-only index, so it counts revoked rows too.
   */
  async function recordPairing({
    inviteToken,
    installId = '',
    inviteRecord,
    userAgent = null,
    now = Date.now(),
  }) {
    if (typeof inviteToken !== 'string' || inviteToken.length === 0) {
      return { ok: false, code: 'BAD_REQUEST', message: 'Invite token is required.' };
    }

    const pairingId = pairingIdFor(inviteToken, installId);
    const existing = await getPairing(pairingId);
    if (existing) {
      await touch(existing, now);
      return { ok: true, pairingId, isNew: false };
    }

    const ref = parentRefOf(inviteToken);
    const used = await countPairingsForInvite(ref);
    if (used >= MAX_PAIRINGS) {
      return {
        ok: false,
        code: 'PAIRING_LIMIT',
        message: `This link has reached ${MAX_PAIRINGS} devices. Ask the person who sent it for a new link.`,
      };
    }

    const record = buildPairingRecord({
      inviteToken,
      installId,
      userAgent,
      now,
    });

    try {
      await store.set(pairingKey(pairingId), record, { keyPolicy: 'FAIL_IF_EXISTS' });
    } catch (e) {
      // Lost the race for the same (invite, installId): not an error.
      const winner = await getPairing(pairingId);
      if (!winner) {
        console.error('[JiraTack] Pairing write failed:', e && e.message ? e.message : e);
        return { ok: false, code: 'INTERNAL', message: 'Could not record this device.' };
      }
      return { ok: true, pairingId, isNew: false };
    }

    await store.set(
      pairingIndexKey(ref, pairingId),
      { pairingId, installId: installId || '', firstSeenAt: now },
    );

    return { ok: true, pairingId, isNew: true };
  }

  return { recordPairing, getPairing, listPairingsForInvite, countPairingsForInvite };
}
