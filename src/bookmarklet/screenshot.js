import html2canvas from 'html2canvas';
import { maskRect } from './cropGeometry.js';

const CROP_SIZE = 800;

/** JiraTack's own chrome: excluded from every raster, never hidden from the reviewer. */
export function isJiraTackChrome(element) {
  if (!element || typeof element.id !== 'string') return false;
  return element.id === 'jiratack-overlay' || element.id === 'jiratack-viewport-bar';
}

// A full-page raster of a heavy page can take many seconds. A card preview is
// nice to have; holding the save for it is not. Past this budget the caller
// falls back to the ticket's own screenshot.
const THUMBNAIL_RENDER_BUDGET_MS = 2500;

function withinBudget(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
const WEBP_QUALITY = 0.85;
const PIN_RADIUS = 9;
const PIN_COLOR = '#ff6b6b';
const PIN_BORDER = '#ffffff';

function drawPinMarker(context, x, y) {
  context.save();
  context.beginPath();
  context.arc(x, y, PIN_RADIUS, 0, Math.PI * 2);
  context.fillStyle = PIN_COLOR;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = PIN_BORDER;
  context.stroke();
  context.restore();
}


/**
 * The sidebar is JiraTack's own chrome and must not appear in a raster — but it
 * must stay on screen. A tab capture is the screen itself, so the sidebar is
 * measured and excluded from the crop (or masked) instead of being hidden.
 */
function sidebarRect() {
  const sidebar = document.getElementById('jiratack-sidebar');
  if (!sidebar) return null;
  const rect = sidebar.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function nextPaint() {
  return new Promise((resolve) => {
    if (!window.requestAnimationFrame) {
      window.setTimeout(resolve, 16);
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function cropVisibleTab(dataUrl, clientX, clientY, options) {
  const image = await loadImage(dataUrl);
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const dprX = image.naturalWidth / viewportWidth;
  const dprY = image.naturalHeight / viewportHeight;
  const srcW = Math.max(1, Math.min(image.naturalWidth, Math.round(Math.min(CROP_SIZE, viewportWidth) * dprX)));
  const srcH = Math.max(1, Math.min(image.naturalHeight, Math.round(Math.min(CROP_SIZE, viewportHeight) * dprY)));

  const desiredLeft = clientX * dprX - srcW / 2;
  const desiredTop = clientY * dprY - srcH / 2;
  const srcLeft = Math.max(0, Math.min(desiredLeft, image.naturalWidth - srcW));
  const srcTop = Math.max(0, Math.min(desiredTop, image.naturalHeight - srcH));

  const output = document.createElement('canvas');
  output.width = CROP_SIZE;
  output.height = CROP_SIZE;
  const context = output.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
  context.drawImage(image, srcLeft, srcTop, srcW, srcH, 0, 0, CROP_SIZE, CROP_SIZE);

  // JiraTack's own sidebar is on screen (deliberately) and may sit inside the
  // crop; blank that region so the evidence never contains our UI.
  maskRect(
    context,
    options.avoid,
    {
      left: srcLeft / dprX,
      top: srcTop / dprY,
      right: (srcLeft + srcW) / dprX,
      bottom: (srcTop + srcH) / dprY,
    },
    { width: CROP_SIZE, height: CROP_SIZE },
  );

  // Keep the pin on the click, even when the crop is clamped at an edge.
  const cssCropW = srcW / dprX;
  const cssCropH = srcH / dprY;
  const pinX = (clientX - srcLeft / dprX) * (CROP_SIZE / cssCropW);
  const pinY = (clientY - srcTop / dprY) * (CROP_SIZE / cssCropH);
  drawPinMarker(context, pinX, pinY);

  let result = null;
  if (!options.png) {
    result = output.toDataURL('image/webp', WEBP_QUALITY);
    if (!result || result.indexOf('data:image/webp') !== 0) result = null;
  }
  if (!result) result = output.toDataURL('image/png');
  return result;
}

async function captureTabScreenshot(clientX, clientY, options) {
  // Only small chrome is hidden: the pin layer, the width bar and any page
  // preview. The sidebar is never hidden — it is masked out of the result, so
  // the reviewer's panel does not blink on every capture.
  const hidden = ['jiratack-pins', 'jiratack-text-preview-host', 'jiratack-viewport-bar']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const previousVisibility = hidden.map((element) => element.style.visibility);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    hidden.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] || '';
    });
  };

  hidden.forEach((element) => {
    element.style.visibility = 'hidden';
  });

  try {
    // Let the browser paint the chrome-free frame before the tab is captured.
    await nextPaint();
    const dataUrl = await options.captureTab();
    // The bitmap is what needed the UI gone. Decoding and cropping it are
    // slower than the capture, and the reviewer should not watch an empty
    // screen while they happen.
    restore();
    if (!dataUrl) return null;
    return await cropVisibleTab(dataUrl, clientX, clientY, { ...options, avoid: sidebarRect() });
  } catch (e) {
    return null;
  } finally {
    restore();
  }
}

export async function captureScreenshot(clientX, clientY, options = {}) {
  if (typeof options.captureTab === 'function') {
    return captureTabScreenshot(clientX, clientY, options);
  }

  // JiraTack's own chrome never becomes evidence, and it is never hidden: the
  // overlay is omitted from the raster instead, so the sidebar and the composer
  // stay exactly where the reviewer left them (a render can take seconds).
  const scale = options.scale || window.devicePixelRatio || 1;
  const documentX = clientX + window.scrollX;
  const documentY = clientY + window.scrollY;
  const documentWidth = Math.max(
    document.documentElement ? document.documentElement.scrollWidth : 0,
    window.innerWidth || 0,
    1,
  );
  const documentHeight = Math.max(
    document.documentElement ? document.documentElement.scrollHeight : 0,
    window.innerHeight || 0,
    1,
  );

  const desiredLeft = documentX - CROP_SIZE / 2;
  const desiredTop = documentY - CROP_SIZE / 2;
  const maxLeft = Math.max(0, documentWidth - CROP_SIZE);
  const maxTop = Math.max(0, documentHeight - CROP_SIZE);
  const captureLeft = Math.max(0, Math.min(desiredLeft, maxLeft));
  const captureTop = Math.max(0, Math.min(desiredTop, maxTop));
  const captureWidth = Math.max(1, Math.min(CROP_SIZE, documentWidth - captureLeft));
  const captureHeight = Math.max(1, Math.min(CROP_SIZE, documentHeight - captureTop));

  try {
    const canvas = await html2canvas(document.documentElement, {
      scale,
      useCORS: true,
      logging: false,
      x: captureLeft,
      y: captureTop,
      width: captureWidth,
      height: captureHeight,
      ignoreElements: isJiraTackChrome,
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    const output = document.createElement('canvas');
    output.width = CROP_SIZE;
    output.height = CROP_SIZE;

    const context = output.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    context.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      captureLeft - desiredLeft,
      captureTop - desiredTop,
      captureWidth,
      captureHeight,
    );
    drawPinMarker(context, CROP_SIZE / 2, CROP_SIZE / 2);

    let dataUrl = null;
    // A pin move names its attachment `…-<timestamp>.png`, so the bytes must be
    // PNG too. The creation path keeps WebP; do not change its output.
    if (!options.png) {
      dataUrl = output.toDataURL('image/webp', WEBP_QUALITY);
      if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) dataUrl = null;
    }
    if (!dataUrl) {
      dataUrl = output.toDataURL('image/png');
    }
    console.log('[JiraTack] Screenshot captured successfully');
    return dataUrl;
  } catch (e) {
    console.log('[JiraTack] Screenshot failed', e);
    return null;
  }
}

/**
 * A canvas card preview (D43): a viewport shot of the page the reviewer is on,
 * captured locally at the first ticket of a canvas. No third-party image
 * service and no server-side browser: the bytes come from the page itself.
 */
export async function captureCanvasThumbnail() {
  const viewportWidth = Math.max(320, document.documentElement.clientWidth || window.innerWidth);
  const viewportHeight = Math.max(200, window.innerHeight);

  // The overlay stays on screen and is omitted from the raster: hiding it is
  // what made the sidebar vanish for as long as the render took. `ignoreElements`
  // is the same trick the pin screenshot uses to keep its composer visible.
  try {
    const scale = Math.min(1, 480 / viewportWidth);
    const render = html2canvas(document.documentElement, {
      scale,
      useCORS: true,
      logging: false,
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
      ignoreElements: isJiraTackChrome,
    });

    const canvas = await withinBudget(render, THUMBNAIL_RENDER_BUDGET_MS);
    if (!canvas) {
      console.warn('[JiraTack] Canvas preview render took too long; using the ticket screenshot.');
      return null;
    }
    const dataUrl = canvas.width > 0 ? canvas.toDataURL('image/jpeg', 0.6) : null;
    return downscaleDataUrl(dataUrl, 480);
  } catch (e) {
    return null;
  }
}

/**
 * The card preview is stored on a Forge record (240 KB max), so the encoded
 * string has to fit with room to spare. A single quality setting can overflow
 * on a busy page, which silently produced no preview at all; step down until it
 * fits instead.
 */
const THUMBNAIL_MAX_CHARS = 90000;

async function encodeThumbnail(image, maxWidth) {
  const naturalWidth = image.naturalWidth || maxWidth;
  const naturalHeight = image.naturalHeight || Math.round(maxWidth * 0.6);
  const attempts = [
    [maxWidth, 0.6],
    [maxWidth, 0.45],
    [Math.round(maxWidth * 0.75), 0.4],
    [Math.round(maxWidth * 0.5), 0.35],
  ];
  for (const [width, quality] of attempts) {
    const scale = Math.min(1, width / Math.max(1, naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = canvas.toDataURL('image/jpeg', quality);
    if (jpeg.indexOf('data:image/jpeg') === 0 && jpeg.length <= THUMBNAIL_MAX_CHARS) {
      return jpeg;
    }
  }
  return null;
}

async function downscaleDataUrl(dataUrl, maxWidth) {
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) return null;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return await encodeThumbnail(image, maxWidth);
  } catch (e) {
    return null;
  }
}

/** Downscale any image data URL to the canvas-card size (D43 fallback). */
export async function thumbnailFromDataUrl(dataUrl, maxWidth = 480) {
  return downscaleDataUrl(dataUrl, maxWidth);
}
