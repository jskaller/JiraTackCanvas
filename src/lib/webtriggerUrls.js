import { webTrigger } from '@forge/api';

export async function resolveWebtriggerUrls(config) {
  const cached = (config && config.webtriggerUrls) || {};
  let apiUrl = cached.api || null;
  let sdkUrl = cached.sdk || null;

  if (!apiUrl) {
    try {
      apiUrl = await webTrigger.getUrl('jiratack-api');
    } catch (e) {
      apiUrl = null;
    }
  }
  if (!sdkUrl) {
    try {
      sdkUrl = await webTrigger.getUrl('jiratack-sdk');
    } catch (e) {
      sdkUrl = null;
    }
  }
  return { apiUrl, sdkUrl };
}
