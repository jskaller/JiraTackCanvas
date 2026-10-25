import { sdkSource } from '../lib/sdk-bundle.js';

export const handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': ['application/javascript; charset=utf-8'],
      'Cache-Control': ['public, max-age=31536000, immutable'],
    },
    body: sdkSource,
  };
};
