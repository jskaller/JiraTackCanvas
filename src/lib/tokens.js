import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { kvsGet, kvsSet } from './kvs.js';

const SECRET_KEY = 'sessionSigningSecret';
const ALGORITHM = 'HS256';

let secretPromise = null;

async function loadOrCreateSecret() {
  const existing = await kvsGet(SECRET_KEY);
  if (existing) return existing;

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    // Compare-and-set: only create when absent, so two cold-starting
    // instances cannot each mint a secret and orphan each other's JWTs.
    await kvsSet(SECRET_KEY, secret, { version: { type: 'must_be_missing' } });
    return secret;
  } catch (e) {
    const winner = await kvsGet(SECRET_KEY);
    if (winner) return winner;
    throw e;
  }
}

export async function getSigningSecret() {
  if (!secretPromise) {
    secretPromise = loadOrCreateSecret().catch((e) => {
      secretPromise = null;
      throw e;
    });
  }
  return secretPromise;
}

export async function generateSessionJwt(payload) {
  const secret = await getSigningSecret();
  return jwt.sign(payload, secret, { algorithm: ALGORITHM });
}

export async function verifySessionJwt(token) {
  const secret = await getSigningSecret();
  return jwt.verify(token, secret, { algorithms: [ALGORITHM] });
}
