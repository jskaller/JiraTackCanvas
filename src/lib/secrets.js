import crypto from 'crypto';
import { kvsGetSecret, kvsSetSecretIfAbsent } from './kvs.js';

/**
 * Secrets that are not the session signing key.
 *
 * `bindingSecret` derives bindingId = HMAC(email). It must never rotate: every
 * binding key and every backfilled ticket references it (D24, D27). The session
 * signing secret is deliberately separate so it can rotate freely.
 */
const BINDING_SECRET_KEY = 'bindingSecret';

let bindingSecretPromise = null;

async function loadOrCreateBindingSecret() {
  const existing = await kvsGetSecret(BINDING_SECRET_KEY);
  if (existing) return existing;

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    await kvsSetSecretIfAbsent(BINDING_SECRET_KEY, secret);
    return secret;
  } catch (e) {
    const winner = await kvsGetSecret(BINDING_SECRET_KEY);
    if (winner) return winner;
    throw e;
  }
}

export async function getBindingSecret() {
  if (!bindingSecretPromise) {
    bindingSecretPromise = loadOrCreateBindingSecret().catch((e) => {
      bindingSecretPromise = null;
      throw e;
    });
  }
  return bindingSecretPromise;
}

export const BINDING_SECRET_KEY_NAME = BINDING_SECRET_KEY;
