import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { kvsGet, kvsSetIfAbsent } from './kvs.js';

const SECRET_KEY = 'sessionSigningSecret';
const ALGORITHM = 'HS256';

let secretPromise = null;

async function loadOrCreateSecret() {
  const existing = await kvsGet(SECRET_KEY);
  if (existing) return existing;

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    // Conditional create: two cold-starting instances cannot each mint a secret
    // and orphan each other's JWTs. Uses keyPolicy, which is the API's real CAS;
    // the previous `{ version: { type: 'must_be_missing' } }` option was ignored.
    await kvsSetIfAbsent(SECRET_KEY, secret);
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
