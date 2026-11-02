/**
 * Pure invitation rules. No Forge imports.
 *
 * A guest invitation is one reviewer, named at issuance. The link it produces
 * expires after 72h; the invitation itself does not — access continues until it
 * is deactivated or revoked, or the reviewer's pairings are revoked.
 */

export const LINK_TTL_MS = 72 * 60 * 60 * 1000;

export const INVITE_ACTIVE = 'active';
export const INVITE_INACTIVE = 'inactive';
export const INVITE_REVOKED = 'revoked';

/** New invites carry linkExpiresAt; legacy records used expiresAt. */
export function linkExpiresAt(invite) {
  if (!invite) return null;
  return invite.linkExpiresAt != null ? invite.linkExpiresAt : (invite.expiresAt != null ? invite.expiresAt : null);
}

export function invitationState(invite) {
  if (!invite) return INVITE_REVOKED;
  if (invite.revoked) return INVITE_REVOKED;
  return invite.state === INVITE_INACTIVE ? INVITE_INACTIVE : INVITE_ACTIVE;
}

/**
 * Status shown in the list: revoked > inactive > expired link > active.
 * "expired" describes the link only — an expired link still has live pairings
 * and an active invitation.
 */
export function invitationStatus(invite, now) {
  const state = invitationState(invite);
  if (state !== INVITE_ACTIVE) return state;
  const expiry = linkExpiresAt(invite);
  if (expiry != null && Number(expiry) < Number(now)) return 'expired';
  return INVITE_ACTIVE;
}

/** New devices may only pair while the invitation is active and the link unexpired. */
export function canPairNewDevice(invite, now) {
  if (invitationState(invite) !== INVITE_ACTIVE) return false;
  const expiry = linkExpiresAt(invite);
  return expiry == null || Number(expiry) >= Number(now);
}

/**
 * An existing pairing may exchange while the invitation is active, regardless
 * of link expiry. Revoking the invitation still kills it (structural cascade).
 */
export function canUseExistingPairing(invite) {
  return invitationState(invite) === INVITE_ACTIVE;
}
