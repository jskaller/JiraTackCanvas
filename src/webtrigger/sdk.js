import { sdkSource } from '../lib/sdk-bundle.js';
import { SDK_VERSION } from '../lib/version.js';

/**
 * The bundle was served `immutable`, which pinned every bookmark to the version
 * it was dragged with — forever, even after the bookmarklet warned it was out
 * of date. Revalidating instead means an existing bookmark picks up SDK fixes
 * without a re-drag. ETag keeps that cheap: unchanged bundle → 304.
 *
 * CORS is required by the fallback loader (D31): when the host page's
 * `script-src` refuses our origin as an external script, the bookmarklet
 * fetches this bundle and injects it as an inline script instead. That `fetch`
 * is cross-origin and is refused without `Access-Control-Allow-Origin`, so the
 * fallback would fail on exactly the sites it exists for. The bundle is public
 * code served to any page that asks, so `*` is appropriate and no credentials
 * are involved.
 */
export const handler = async (req) => {
  const etag = `"${SDK_VERSION}"`;
  const cors = {
    'Access-Control-Allow-Origin': ['*'],
    'Access-Control-Allow-Methods': ['GET, HEAD, OPTIONS'],
    'Access-Control-Allow-Headers': ['If-None-Match, Content-Type'],
    'Access-Control-Expose-Headers': ['ETag, Content-Length'],
  };
  const headers = (extra) => ({
    'Content-Type': ['text/javascript; charset=utf-8'],
    'Cache-Control': ['no-cache'],
    ETag: [etag],
    ...cors,
    ...extra,
  });

  const method = String((req && req.method) || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: headers(), body: '' };
  }

  const requestHeaders = (req && req.headers) || {};
  const key = Object.keys(requestHeaders).find((name) => name.toLowerCase() === 'if-none-match');
  const ifNoneMatch = key ? requestHeaders[key] : null;
  const value = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;

  if (value && String(value).split(',').map((part) => part.trim()).includes(etag)) {
    return { statusCode: 304, headers: headers(), body: '' };
  }

  return { statusCode: 200, headers: headers(), body: sdkSource };
};
