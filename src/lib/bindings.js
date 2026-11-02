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
 * The reviewer binding exists from issuance (D30): the sponsor names the guest,
 * so identity is known before the first pin. State stays `issued` until a pin
 * succeeds, which is the billable activation.
 */
export async function ensureBinding({ email, issuedBy, canvasNames, now = Date.now() }) {
  const secret = await getBindingSecret();
  const bindingId = bindingIdFor(email, secret);
  if (!bindingId) return null;

  const key = bindingKey(bindingId);
  const existing = await kvsGet(key);
  if (existing) {
    if (Array.isArray(canvasNames) && canvasNames.length > 0) {
      const access = new Set(Array.isArray(existing.canvasAccess) ? existing.canvasAccess : []);
      canvasNames.forEach((name) => { if (name) access.add(name); });
      const merged = { ...existing, canvasAccess: Array.from(access) };
      await kvsSet(key, merged);
      return merged;
    }
    return existing;
  }

  const binding = createBinding({
    bindingId,
    email,
    issuedBy,
    canvasName: Array.isArray(canvasNames) ? canvasNames[0] : null,
    now,
  });
  if (Array.isArray(canvasNames) && canvasNames.length > 1) {
    binding.canvasAccess = Array.from(new Set(canvasNames.filter(Boolean)));
  }
  await kvsSet(key, binding);
  return binding;
}

/**
 * Counts one pin against an existing binding. Called after Jira accepts the
 * ticket, so a rejected create never burns a slot or a pin.
 */
export async function recordPinForBinding(bindingId, { canvasName, now = Date.now() }) {
  if (typeof bindingId !== 'string' || bindingId.length === 0) return null;
  const key = bindingKey(bindingId);
  const existing = await kvsGet(key);
  if (!existing) return null;
  const next = applyPin(existing, { canvasName, now });
  await kvsSet(key, next);
  return next;
}
