import { kvsGet, kvsSet } from './kvs.js';
import { getBindingSecret } from './secrets.js';
import { applyPin, bindingIdFor, createBinding } from './bindingModel.js';

export const BINDING_PREFIX = 'bindings:';

export function bindingKey(bindingId) {
  return `${BINDING_PREFIX}${bindingId}`;
}

export async function getBinding(bindingId) {
  if (typeof bindingId !== 'string' || bindingId.length === 0) return null;
  const record = await kvsGet(bindingKey(bindingId));
  return record || null;
}

/**
 * Records a guest pin against its reviewer binding (D24).
 *
 * Created lazily at the first pin, because the email does not exist before
 * then. Returns the updated binding, or null when the email cannot be keyed.
 * Failures are the caller's to handle: a binding write must never block a
 * ticket that Jira has already created.
 */
export async function recordGuestPin({ email, issuedBy, canvasName, now = Date.now() }) {
  const secret = await getBindingSecret();
  const bindingId = bindingIdFor(email, secret);
  if (!bindingId) return null;

  const key = bindingKey(bindingId);
  const existing = await kvsGet(key);
  const base = existing || createBinding({ bindingId, email, issuedBy, canvasName, now });
  const next = applyPin(base, { canvasName, now });

  await kvsSet(key, next);
  return next;
}
