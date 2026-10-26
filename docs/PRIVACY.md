# JiraTack Privacy Policy

_Last updated: [TODO: date]_

JiraTack is a Jira Cloud app that lets QA teams drop pins on web pages and turn
them into Jira tickets. This document is a placeholder for the Marketplace
privacy policy and must be reviewed before submission.

## Data we store

- **App configuration (Forge KVS):** field registry IDs, project settings,
  `viewPermissionMode`, and configuration version metadata.
- **Canvas tokens (Forge KVS):** a hashed/opaque canvas token identifier,
  canvas name, issuing Atlassian account ID, installation ID, scope, issue and
  expiry timestamps, revocation flag, and the permitted project keys captured at
  issuance. Tokens expire after 30 days.
- **Session signing secret (Forge KVS):** a random 256-bit secret used to sign
  short-lived session JWTs (8 hours).
- **Canvas-token project cache (Forge KVS):** canvas name → project key with a
  300-second TTL.
- **Jira custom fields:** canvas name, normalized page URL, pin position, and
  CSS selector are stored on the Jira issues the app creates.

## Data we do not store

- Page content, screenshots, or console output are stored only as Jira issue
  attachments/descriptions when a user submits a ticket. They are not retained
  by the app outside Jira.
- We do not sell or share data with third parties.

## Data location and retention

- Data is stored in Atlassian Forge infrastructure for the lifetime of the
  installation. Uninstalling the app removes KVS data in accordance with Forge
  platform behavior.
- Canvas tokens can be revoked from the JiraTack dashboard. Revocation takes
  effect immediately for new session exchanges; existing session JWTs remain
  valid for up to 8 hours.

## Contact

[TODO: support contact / privacy contact]
