import api, { route } from '@forge/api';
import { kvsGet } from '../../lib/kvs.js';
import { getInstallationConfig } from '../../lib/config.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60;
let cachedJiraBaseUrl = null;

async function getJiraBaseUrl() {
  if (cachedJiraBaseUrl) return cachedJiraBaseUrl;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`);
    if (res.ok) {
      const data = await res.json();
      cachedJiraBaseUrl = data && data.baseUrl ? data.baseUrl : null;
    }
  } catch (e) {
    cachedJiraBaseUrl = null;
  }
  return cachedJiraBaseUrl;
}

function tokenFromPayload(payload) {
  if (!payload) return '';
  return payload.canvasToken || payload.userToken || payload.token || '';
}

async function commonResponse(config, extra) {
  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);
  const jiraBaseUrl = await getJiraBaseUrl();
  return {
    ok: true,
    data: {
      apiUrl,
      sdkUrl,
      jiraBaseUrl,
      configVersion: config.configVersion || '',
      ...extra,
    },
  };
}

export async function exchangeToken(payload) {
  const token = tokenFromPayload(payload);
  if (typeof token !== 'string' || token.length === 0) {
    return errorResult('BAD_REQUEST', 'canvasToken is required.');
  }

  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const exp = iat + SESSION_TTL_SECONDS;

  const userRecord = await kvsGet(`userTokens:${token}`);
  if (userRecord) {
    if (userRecord.revoked) {
      return errorResult('TOKEN_INVALID', 'User token has been revoked.');
    }
    if (userRecord.expiresAt && userRecord.expiresAt < now) {
      return errorResult('TOKEN_EXPIRED', 'User token has expired.');
    }

    let permittedProjects = '*';
    if (typeof userRecord.permittedProjectsJson === 'string') {
      try {
        permittedProjects = JSON.parse(userRecord.permittedProjectsJson);
      } catch (e) {
        permittedProjects = [];
      }
    }

    const sessionJwt = await generateSessionJwt({
      iss: 'jiratack',
      sub: userRecord.userId,
      aud: userRecord.installationId,
      scope: 'universal',
      permittedProjects,
      iat,
      exp,
    });

    const config = await getInstallationConfig();
    return commonResponse(config, {
      sessionJwt,
      expiresAt: exp * 1000,
      canvasId: null,
      canvasName: null,
      scope: 'universal',
      permittedProjects,
    });
  }

  const record = await kvsGet(`canvasTokens:${token}`);
  if (!record) {
    return errorResult('TOKEN_INVALID', 'Canvas token not found.');
  }
  if (record.revoked) {
    return errorResult('TOKEN_INVALID', 'Canvas token has been revoked.');
  }
  if (record.expiresAt && record.expiresAt < now) {
    return errorResult('TOKEN_EXPIRED', 'Canvas token has expired.');
  }

  let permittedProjects;
  if (typeof record.permittedProjectsJson === 'string') {
    try {
      permittedProjects = JSON.parse(record.permittedProjectsJson);
    } catch (e) {
      permittedProjects = [];
    }
  } else {
    permittedProjects = record.permittedProjects === undefined ? [] : record.permittedProjects;
  }

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
  return commonResponse(config, {
    sessionJwt,
    expiresAt: exp * 1000,
    canvasId: record.canvasName,
    canvasName: record.canvasName,
    scope: record.scope,
    permittedProjects,
  });
}
