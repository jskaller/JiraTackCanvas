import { webTrigger } from '@forge/api';

export async function resolveWebtriggerUrls(config) {
  const cached = (config && config.webtriggerUrls) || {};
  let apiUrl = cached.api || null;
  let sdkUrl = cached.sdk || null;
  let installUrl = cached.install || null;

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
  if (!installUrl) {
    try {
      installUrl = await webTrigger.getUrl('jiratack-install');
    } catch (e) {
      installUrl = null;
    }
  }
  return { apiUrl, sdkUrl, installUrl };
}
