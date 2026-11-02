import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';

/**
 * "Let Jira decide" (plan 6.2): the client must not guess a size limit. Jira
 * publishes one per site, and an admin may have raised it, so we ask.
 */
export async function attachmentLimits() {
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/attachment/meta`);
    if (!res.ok) {
      return errorResult('INTERNAL', `Could not read attachment limits (HTTP ${res.status}).`);
    }
    const data = await res.json();
    return {
      ok: true,
      data: {
        enabled: data && data.enabled === true,
        uploadLimit: Number(data && data.uploadLimit) || 0,
      },
    };
  } catch (e) {
    return errorResult('INTERNAL', 'Could not read attachment limits.');
  }
}
