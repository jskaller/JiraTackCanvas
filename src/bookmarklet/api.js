import { normalizeUrl } from '../shared/urlNormalize.js';
import { exchangeSession as browserExchangeSession } from './auth.js';
import { postJson } from './transport.js';

/**
 * DOM-free API client. `exchangeSession` is injectable so an extension can
 * supply its own session manager; the bookmarklet uses the browser default.
 */
export function createApiClient(options = {}) {
  const exchangeSession = options.exchangeSession || browserExchangeSession;

  async function postAction(config, session, action, payload, authenticated, attempt) {
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated && session && session.jwt) {
      headers.Authorization = `Bearer ${session.jwt}`;
    }

    // The extension channel relays through the bridge (page CSP cannot block
    // it); the bookmarklet posts directly.
    const response = await postJson(config, { action, payload }, headers);

    let body;
    try {
      body = await response.json();
    } catch (e) {
      throw new Error(`${action} returned an invalid response.`);
    }

    if (!body || body.ok !== true) {
      const code = body && body.error && body.error.code;
      // A stale session should self-heal rather than surface an error the user
      // cannot act on; this also bounds the practical revocation window.
      if (authenticated && !attempt && (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') && config.token) {
        try {
          const fresh = await exchangeSession(config, { force: true });
          if (session) {
            session.jwt = fresh.jwt;
            session.expiresAt = fresh.expiresAt;
            session.displayName = fresh.displayName;
          }
          return postAction(config, session, action, payload, authenticated, true);
        } catch (refreshError) {
          // fall through to the original error
        }
      }
      const error = new Error((body && body.error && body.error.message) || `${action} failed.`);
      error.code = code;
      error.details = body && body.error && body.error.details;
      throw error;
    }

    return body.data;
  }

  async function getPins(config, session, canvasId, url, all = false) {
    return postAction(
      config,
      session,
      'getPinsForCanvasAndUrl',
      { canvasId, url: normalizeUrl(url), all: Boolean(all) },
      true,
    );
  }

  async function createIssue(config, session, payload) {
    return postAction(config, session, 'createIssue', payload, true);
  }

  async function getTransitions(config, session, issueKey) {
    return postAction(config, session, 'getTransitions', { issueKey }, true);
  }

  async function updateIssue(config, session, issueKey, fields) {
    return postAction(config, session, 'updateIssue', { issueKey, fields }, true);
  }

  async function updatePinPosition(config, session, payload) {
    return postAction(config, session, 'updatePinPosition', payload, true);
  }

  async function getPriorities(config, session) {
    return postAction(config, session, 'getPriorities', {}, true);
  }

  async function getIssueTypes(config, session, projectKey) {
    return postAction(config, session, 'getIssueTypes', { projectKey }, true);
  }

  async function listCanvasesForUser(config, session) {
    return postAction(config, session, 'listCanvasesForUser', {}, true);
  }

  async function createCanvas(config, session, canvasName, targetUrl) {
    return postAction(config, session, 'createCanvas', { canvasName, targetUrl }, true);
  }

  async function searchUsers(config, session, projectKey, query) {
    return postAction(config, session, 'searchUsers', { projectKey, query }, true);
  }

  /**
   * Uploads a data-URL screenshot in small chunks and returns an upload id.
   * createIssue then sends only the id, never the binary payload.
   */
  async function uploadScreenshot(config, session, dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) return null;

    const mimeType = match[1];
    const base64 = match[2];
    const begin = await postAction(
      config,
      session,
      'beginScreenshotUpload',
      { mimeType, size: base64.length },
      true,
    );
    if (!begin || !begin.uploadId) return null;

    const chunkSize = begin.chunkSize || 200 * 1024;
    let index = 0;
    for (let offset = 0; offset < base64.length; offset += chunkSize, index += 1) {
      await postAction(
        config,
        session,
        'uploadScreenshotChunk',
        {
          uploadId: begin.uploadId,
          index,
          data: base64.slice(offset, offset + chunkSize),
        },
        true,
      );
    }

    return begin.uploadId;
  }

  /**
   * Any file, not just images: the web trigger validates the type and Jira
   * enforces the size. Returns an upload id for createIssue to attach.
   */
  async function uploadAttachment(config, session, { dataUrl, filename, mimeType }) {
    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!match) return null;

    const type = mimeType || match[1];
    const base64 = match[2];
    const begin = await postAction(
      config,
      session,
      'beginScreenshotUpload',
      { mimeType: type, size: base64.length, filename: filename || null },
      true,
    );
    if (!begin || !begin.uploadId) return null;

    const chunkSize = begin.chunkSize || 200 * 1024;
    let index = 0;
    for (let offset = 0; offset < base64.length; offset += chunkSize, index += 1) {
      await postAction(
        config,
        session,
        'uploadScreenshotChunk',
        { uploadId: begin.uploadId, index, data: base64.slice(offset, offset + chunkSize) },
        true,
      );
    }
    return begin.uploadId;
  }

  async function getAttachmentLimits(config, session) {
    return postAction(config, session, 'attachmentLimits', {}, true);
  }

  return {
    postAction,
    getPins,
    createIssue,
    getTransitions,
    updateIssue,
    updatePinPosition,
    getPriorities,
    getIssueTypes,
    listCanvasesForUser,
    createCanvas,
    searchUsers,
    uploadScreenshot,
    uploadAttachment,
    getAttachmentLimits,
  };
}

const browserClient = createApiClient();

export const postAction = browserClient.postAction;
export const getPins = browserClient.getPins;
export const createIssue = browserClient.createIssue;
export const getTransitions = browserClient.getTransitions;
export const updateIssue = browserClient.updateIssue;
export const updatePinPosition = browserClient.updatePinPosition;
export const getPriorities = browserClient.getPriorities;
export const getIssueTypes = browserClient.getIssueTypes;
export const listCanvasesForUser = browserClient.listCanvasesForUser;
export const createCanvas = browserClient.createCanvas;
export const searchUsers = browserClient.searchUsers;
export const uploadScreenshot = browserClient.uploadScreenshot;
export const uploadAttachment = browserClient.uploadAttachment;
export const getAttachmentLimits = browserClient.getAttachmentLimits;
