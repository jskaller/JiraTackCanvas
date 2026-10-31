import crypto from 'crypto';

/**
 * Pure binding rules. No KVS, no Forge imports, so they are unit-testable.
 *
 * A binding is one external reviewer per installation (D24): email-scoped,
 * created lazily at the first pin, keyed by HMAC(email) with a dedicated
 * non-rotating secret.
 */

export function normaliseEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function bindingIdFor(email, secret) {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;
  if (typeof secret !== 'string' || secret.length === 0) return null;
  return crypto.createHmac('sha256', secret).update(normalised).digest('hex');
}

/** Billing month bucket, UTC calendar month (D25). */
export function monthKeyOf(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createBinding({ bindingId, email, issuedBy, canvasName, now }) {
  return {
    bindingId,
    email: typeof email === 'string' ? email.trim() : '',
    state: 'issued',
    issuedBy: issuedBy || null,
    canvasAccess: canvasName ? [canvasName] : [],
    firstPinAt: null,
    lastPinAt: null,
    pinCount: 0,
    monthKey: monthKeyOf(now),
    monthPinCount: 0,
    createdAt: now,
    revokedAt: null,
    revokedBy: null,
  };
}

/**
 * Apply one pin to a binding. Returns a new object; never mutates the input.
 * - issued → active on the first pin, with firstPinAt stamped once
 * - month counters roll over at the UTC month boundary; pinCount is lifetime
 */
export function applyPin(binding, { canvasName, now }) {
  const monthKey = monthKeyOf(now);
  const sameMonth = binding.monthKey === monthKey;
  const next = {
    ...binding,
    canvasAccess: Array.isArray(binding.canvasAccess) ? binding.canvasAccess.slice() : [],
  };

  if (canvasName && !next.canvasAccess.includes(canvasName)) {
    next.canvasAccess.push(canvasName);
  }

  next.pinCount = (binding.pinCount || 0) + 1;
  next.monthPinCount = (sameMonth ? binding.monthPinCount || 0 : 0) + 1;
  next.monthKey = monthKey;
  next.lastPinAt = now;

  if (next.state === 'issued') {
    next.state = 'active';
    next.firstPinAt = now;
  }

  return next;
}
