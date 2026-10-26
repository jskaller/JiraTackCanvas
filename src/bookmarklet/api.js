import { normalizeUrl } from '../shared/urlNormalize.js';

async function postAction(config, session, action, payload, authenticated) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated && session && session.jwt) {
    headers.Authorization = `Bearer ${session.jwt}`;
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, payload }),
  });

  let body;
  try {
    body = await response.json();
  } catch (e) {
    throw new Error(`${action} returned an invalid response.`);
  }

  if (!body || body.ok !== true) {
    const error = new Error((body && body.error && body.error.message) || `${action} failed.`);
    error.code = body && body.error && body.error.code;
    error.details = body && body.error && body.error.details;
    throw error;
  }

  return body.data;
}

export async function getPins(config, session, canvasId, url) {
  return postAction(
    config,
    session,
    'getPinsForCanvasAndUrl',
    { canvasId, url: normalizeUrl(url) },
    true,
  );
}

export async function createIssue(config, session, payload) {
  return postAction(config, session, 'createIssue', payload, true);
}

export async function getTransitions(config, session, issueKey) {
  return postAction(config, session, 'getTransitions', { issueKey }, true);
}

export async function updateIssue(config, session, issueKey, fields) {
  return postAction(config, session, 'updateIssue', { issueKey, fields }, true);
}

export async function getPriorities(config, session) {
  return postAction(config, session, 'getPriorities', {}, true);
}

export async function getIssueTypes(config, session, projectKey) {
  return postAction(config, session, 'getIssueTypes', { projectKey }, true);
}

export async function searchUsers(config, session, projectKey, query) {
  return postAction(config, session, 'searchUsers', { projectKey, query }, true);
}
