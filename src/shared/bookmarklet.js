/**
 * Builds the `javascript:` bookmarklet URL from a token payload.
 * Shared by the dashboard modal and the guest installer webtrigger.
 */
export function buildBookmarklet(data) {
  const canvasName = data.canvasName || data.canvasId || 'Canvas';
  const canvasId = data.canvasId || canvasName;
  const config = {
    token: data.token,
    apiUrl: data.apiUrl,
    sdkUrl: data.sdkUrl,
    canvasId,
    canvasName,
    sdkVersion: data.sdkVersion,
    fieldRegistry: data.fieldRegistry || null,
  };
  const code = `(function(){var c=${JSON.stringify(config)};if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}var loaderId='jiratack-bootstrap-loading';var styleId='jiratack-bootstrap-style';var timer=null;function cleanup(){var l=document.getElementById(loaderId);if(l)l.remove();var st=document.getElementById(styleId);if(st)st.remove();if(timer)window.clearTimeout(timer);}var existing=document.getElementById(loaderId);if(existing)existing.remove();var style=document.createElement('style');style.id=styleId;style.textContent='@keyframes jiratack-bootstrap-spin{to{transform:rotate(360deg)}}';document.head.appendChild(style);var loader=document.createElement('div');loader.id=loaderId;loader.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#172b4d;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 12px rgba(9,30,66,.35);pointer-events:none;';var spinner=document.createElement('span');spinner.style.cssText='width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:jiratack-bootstrap-spin .8s linear infinite;';loader.appendChild(spinner);var label=document.createElement('span');label.textContent='JiraTack is opening…';loader.appendChild(label);document.body.appendChild(loader);timer=window.setTimeout(cleanup,15000);var s=document.createElement('script');s.src=c.sdkUrl+'?v='+c.sdkVersion;s.onload=function(){window.__jiratackInit(c);};s.onerror=function(){cleanup();};document.head.appendChild(s);})();`;
  return `javascript:${code}`;
}
