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
  await kvsSet(SECRET_KEY, secret);
  return secret;
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
