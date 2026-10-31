import { INSTALL_ID_RE } from './credentialsModel.js';

/**
 * Composite token parsing: the bookmarklet's existing `canvasToken` field
 * carries `inviteToken.installId`, so no SDK change is needed and legacy bare
 * invites keep working through the same field.
 *
 * A composite whose suffix is not 32 lowercase hex is reported as malformed so
 * the caller can fall through to the canvas-token branch rather than failing
 * early. UUID-shaped suffixes are deliberately not accepted: nothing generates
 * them, and a second accepted format would create two identities for the same
 * install.
 */
export function parseCompositeToken(raw) {
  const value = typeof raw === 'string' ? raw : '';
  const dot = value.indexOf('.');

  if (dot === -1) {
    return { inviteToken: value, installId: '', composite: false };
  }

  const inviteToken = value.slice(0, dot);
  const installId = value.slice(dot + 1);

  if (!inviteToken || !INSTALL_ID_RE.test(installId)) {
    return {
      inviteToken: value,
      installId: '',
      composite: false,
      malformedComposite: true,
    };
  }

  return { inviteToken, installId, composite: true };
}

/** Empty installId must emit a bare token — never `invite.` with a trailing dot. */
export function buildCompositeToken(inviteToken, installId) {
  if (!inviteToken) return '';
  return installId ? `${inviteToken}.${installId}` : inviteToken;
}
