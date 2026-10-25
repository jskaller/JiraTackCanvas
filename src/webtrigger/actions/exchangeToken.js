import { kvsGet } from '../../lib/kvs.js';
import { getInstallationConfig } from '../../lib/config.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function exchangeToken(payload) {
  const canvasToken = payload && payload.canvasToken;
  if (typeof canvasToken !== 'string' || canvasToken.length === 0) {
    return errorResult('BAD_REQUEST', 'canvasToken is required.');
  }

  const record = await kvsGet(`canvasTokens:${canvasToken}`);
  if (!record) {
    return errorResult('TOKEN_INVALID', 'Canvas token not found.');
  }
  if (record.revoked) {
    return errorResult('TOKEN_INVALID', 'Canvas token has been revoked.');
  }

  const now = Date.now();
  if (record.expiresAt && record.expiresAt < now) {
    return errorResult('TOKEN_EXPIRED', 'Canvas token has expired.');
  }

  const permittedProjects = record.permittedProjects === undefined ? [] : record.permittedProjects;
  const iat = Math.floor(now / 1000);
  const exp = iat + SESSION_TTL_SECONDS;

  const sessionJwt = await generateSessionJwt({
    iss: 'jiratack',
    sub: record.userId,
    aud: record.installationId,
    canvasId: record.canvasName,
    canvasName: record.canvasName,
    scope: record.scope,
    permittedProjects,
    iat,
    exp,
  });

  const config = await getInstallationConfig();
  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      sessionJwt,
      expiresAt: exp * 1000,
      canvasId: record.canvasName,
      canvasName: record.canvasName,
      scope: record.scope,
      permittedProjects,
      apiUrl,
      sdkUrl,
      configVersion: config.configVersion || '',
    },
  };
}
