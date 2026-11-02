/**
 * Isolated-world bridge (plan 6.6).
 *
 * The SDK runs in the page's world by requirement, which means it cannot touch
 * extension APIs. Window sizing is an extension API, so a preset click is posted
 * across and relayed here. Nothing else crosses this boundary, and the payload
 * is validated on both sides.
 */
window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  var data = event.data;
  if (!data || data.source !== 'jiratack' || data.type !== 'resize') return;

  var width = data.width === null ? null : Number(data.width);
  if (width !== null && (!isFinite(width) || width < 320 || width > 2560)) return;

  var chromeWidth = Number(data.chromeWidth);
  try {
    chrome.runtime.sendMessage({
      type: 'jiratack-resize',
      width: width,
      chromeWidth: isFinite(chromeWidth) ? chromeWidth : 0,
    });
  } catch (e) {
    // The extension was reloaded; the page keeps working without presets.
  }
});
