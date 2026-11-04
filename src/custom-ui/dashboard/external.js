import { router } from '@forge/bridge';
import { toSafeHttpUrl } from '@shared/safeUrl';

/**
 * Forge Custom UI runs in an iframe where anchor target="_blank" is blocked.
 * `router.open` is the supported way to open a real new tab (D43).
 */
export function openExternal(url) {
  const safe = toSafeHttpUrl(url);
  if (safe) router.open(safe);
}
