import { sdkSource } from '../lib/sdk-bundle.js';
import { SDK_VERSION } from '../lib/version.js';

/**
 * The bundle was served `immutable`, which pinned every bookmark to the version
 * it was dragged with — forever, even after the bookmarklet warned it was out
 * of date. Revalidating instead means an existing bookmark picks up SDK fixes
 * without a re-drag. ETag keeps that cheap: unchanged bundle → 304.
 */
export const handler = async (req) => {
  const etag = `"${SDK_VERSION}"`;
  const headers = (extra) => ({
    'Content-Type': ['text/javascript; charset=utf-8'],
    'Cache-Control': ['no-cache'],
    ETag: [etag],
    ...extra,
  });

  const requestHeaders = (req && req.headers) || {};
  const key = Object.keys(requestHeaders).find((name) => name.toLowerCase() === 'if-none-match');
  const ifNoneMatch = key ? requestHeaders[key] : null;
  const value = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;

  if (value && String(value).split(',').map((part) => part.trim()).includes(etag)) {
    return { statusCode: 304, headers: headers(), body: '' };
  }

  return { statusCode: 200, headers: headers(), body: sdkSource };
};
