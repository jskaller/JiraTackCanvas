import { kvsSet, kvsQueryAll } from './kvs.js';

/**
 * D47: how many people are actually using JiraTack right now.
 *
 * A "user" here is a distinct identity, not a tab and not a token: one person
 * with three windows counts once, and a guest counts as themselves rather than
 * as the sponsor they report through. That is the unit a concurrency-based
 * price would be sold in, so it is the unit measured.
 *
 * Measurement only. No ceiling is enforced here: a cap needs a priced decision,
 * and shipping the number first means the decision can be made on real usage
 * rather than a guess.
 */

const PREFIX = 'meterActive:';

// "Currently open" is defined by this window rather than by a connection,
// because an extension tab has no socket to disconnect.
export const ACTIVE_WINDOW_MS = 20 * 60 * 1000;

// The heartbeat row outlives the window so the dashboard can explain a drop,
// but it is never counted after the window closes.
const ROW_TTL_HOURS = 1;

export function identityKey(kind, id) {
  return `${PREFIX}${kind}:${id}`;
}

/**
 * Records that this identity is in use. Called on a successful credential
 * exchange — the one moment the server knows both who it is and that they are
 * still running — so it costs no extra round trip. Never throws: metering must
 * not fail a sign-in.
 */
export async function heartbeat({ kind, id }, now = Date.now()) {
  if (!id || (kind !== 'user' && kind !== 'guest')) return null;
  const key = identityKey(kind, id);
  try {
    await kvsSet(key, { kind, id: String(id), lastSeenAt: now }, {
      ttl: { value: ROW_TTL_HOURS, unit: 'HOURS' },
    });
    return key;
  } catch (e) {
    return null;
  }
}

/**
 * Counts distinct identities seen inside the window. A user and a guest with
 * the same underlying person are deliberately counted separately: they are
 * different credentials and different audit trails.
 */
export async function countActive(now = Date.now(), windowMs = ACTIVE_WINDOW_MS) {
  const cutoff = now - windowMs;
  let rows = [];
  try {
    rows = await kvsQueryAll(PREFIX, { max: 5000 });
  } catch (e) {
    return { users: 0, guests: 0, total: 0, windowMinutes: Math.round(windowMs / 60000), unavailable: true };
  }

  const seen = new Set();
  let users = 0;
  let guests = 0;

  for (const row of rows) {
    const value = (row && row.value) || {};
    if (!value.id || Number(value.lastSeenAt) < cutoff) continue;
    const kind = value.kind === 'guest' ? 'guest' : 'user';
    const key = `${kind}:${value.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === 'guest') guests += 1;
    else users += 1;
  }

  return {
    users,
    guests,
    total: users + guests,
    windowMinutes: Math.round(windowMs / 60000),
    unavailable: false,
  };
}
