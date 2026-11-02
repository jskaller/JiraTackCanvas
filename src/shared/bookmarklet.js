/**
 * Builds the `javascript:` bookmarklet URL from a token payload.
 * Shared by the dashboard modal and the guest installer webtrigger.
 *
 * The bootstrap injects the SDK as an external `<script>` and therefore runs
 * under the host page's CSP. Failure is reported in-page: a blocked script
 * raises `onerror`, a Trusted Types policy throws synchronously on `s.src`,
 * and a slow network is caught by the timeout. Without this the loader simply
 * vanished and the user saw nothing (D22).
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
  };
  const code = `(function(){var c=${JSON.stringify(config)};if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}var loaderId='jiratack-bootstrap-loading';var styleId='jiratack-bootstrap-style';var timer=null;function cleanup(){var l=document.getElementById(loaderId);if(l)l.remove();var st=document.getElementById(styleId);if(st)st.remove();if(timer){window.clearTimeout(timer);timer=null;}}function fail(reason){if(timer){window.clearTimeout(timer);timer=null;}try{console.error('[JiraTack] '+reason);}catch(e){}var b=document.getElementById(loaderId);if(!b)return;b.textContent='';b.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:420px;padding:10px 12px;border-radius:8px;background:#fff;color:#172b4d;border:1px solid #ff8f73;box-shadow:0 8px 24px rgba(9,30,66,.28);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:auto;';var t=document.createElement('div');t.style.cssText='font-weight:600;margin-bottom:4px;';t.textContent='JiraTack could not start here';var p=document.createElement('div');p.textContent=reason;var d=document.createElement('button');d.type='button';d.textContent='Dismiss';d.style.cssText='margin-top:8px;padding:2px 8px;border:1px solid #dfe1e6;border-radius:3px;background:#fff;cursor:pointer;font:inherit;';d.onclick=cleanup;b.appendChild(t);b.appendChild(p);b.appendChild(d);}var existing=document.getElementById(loaderId);if(existing)existing.remove();var style=document.createElement('style');style.id=styleId;style.textContent='@keyframes jiratack-bootstrap-spin{to{transform:rotate(360deg)}}';document.head.appendChild(style);var loader=document.createElement('div');loader.id=loaderId;loader.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#172b4d;color:#fff;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 12px rgba(9,30,66,.35);pointer-events:none;';var spinner=document.createElement('span');spinner.style.cssText='width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:jiratack-bootstrap-spin .8s linear infinite;';loader.appendChild(spinner);var label=document.createElement('span');label.textContent='JiraTack is opening…';loader.appendChild(label);document.body.appendChild(loader);timer=window.setTimeout(function(){fail('JiraTack took too long to load. Check your connection and try again.');},15000);var s=document.createElement('script');s.onload=function(){if(typeof window.__jiratackInit!=='function'){fail('The script loaded but did not start. Open the browser console for details.');return;}cleanup();window.__jiratackInit(c);};s.onerror=function(){fail("This site's security policy blocks the JiraTack script, so pins cannot be shown here.");};try{s.src=c.sdkUrl+'?v='+c.sdkVersion;}catch(e){fail("This site's security policy (Trusted Types) blocks the JiraTack script, so pins cannot be shown here.");return;}document.head.appendChild(s);})();`;
  return `javascript:${code}`;
}

/**
 * Link back to the installer for this exact bookmarklet, so an out-of-date
 * bookmark can be replaced in one click. Guest tokens are composite
 * (`inviteToken.installId`); carry both so the pairing is preserved.
 */
export function buildRefreshUrl(installUrl, token) {
  if (!installUrl || !token) return null;
  const value = String(token);
  const dot = value.indexOf('.');
  const join = installUrl.includes('?') ? '&' : '?';
  if (dot === -1) {
    return `${installUrl}${join}token=${encodeURIComponent(value)}`;
  }
  const inviteToken = value.slice(0, dot);
  const installId = value.slice(dot + 1);
  return `${installUrl}${join}token=${encodeURIComponent(inviteToken)}&installId=${encodeURIComponent(installId)}`;
}
