import html2canvas from 'html2canvas';

const CROP_SIZE = 800;
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
  const hidden = ['jiratack-overlay', 'jiratack-viewport-bar']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const previousVisibility = hidden.map((element) => element.style.visibility);
  hidden.forEach((element) => {
    element.style.visibility = 'hidden';
  });

  try {
    // Let the browser paint the chrome-free frame before the tab is captured.
    await nextPaint();
    const dataUrl = await options.captureTab();
    if (!dataUrl) return null;
    return await cropVisibleTab(dataUrl, clientX, clientY, options);
  } catch (e) {
    return null;
  } finally {
    hidden.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] || '';
    });
  }
}

export async function captureScreenshot(clientX, clientY, options = {}) {
  if (typeof options.captureTab === 'function') {
    return captureTabScreenshot(clientX, clientY, options);
  }

  // JiraTack's own chrome must never become evidence. The overlay holds the
  // pins and the sidebar, and the extension's viewport bar is mounted on
  // <body>, outside it — hide both, then restore exactly what was there.
  const hidden = ['jiratack-overlay', 'jiratack-viewport-bar']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const previousVisibility = hidden.map((element) => element.style.visibility);

  // A composer can be open while a background screenshot is taken. Keep the
  // composer and the sidebar on screen for the reviewer (focus must survive),
  // but omit them from the raster so they never become evidence.
  const keepIds = Array.isArray(options.keepVisibleIds)
    ? options.keepVisibleIds.filter(Boolean)
    : (options.keepVisibleId ? [options.keepVisibleId] : []);
  const kept = keepIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const previousKeptVisibility = kept.map((element) => element.style.visibility);
  kept.forEach((element) => {
    element.style.visibility = 'visible';
  });

  hidden.forEach((element) => {
    element.style.visibility = 'hidden';
  });

  try {
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

    const canvas = await html2canvas(document.documentElement, {
      scale,
      useCORS: true,
      logging: false,
      x: captureLeft,
      y: captureTop,
      width: captureWidth,
      height: captureHeight,
      ignoreElements: (element) => {
        if (!kept.length || !element) return false;
        return kept.some((node) => {
          if (element === node) return true;
          try {
            return Boolean(element.closest && element.closest(`#${node.id}`));
          } catch (e) {
            return false;
          }
        });
      },
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
  } finally {
    hidden.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] || '';
    });
    kept.forEach((element, index) => {
      element.style.visibility = previousKeptVisibility[index] || '';
    });
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

/**
 * A canvas card preview (D43): a viewport shot of the page the reviewer is on,
 * captured locally at the first ticket of a canvas. No third-party image
 * service and no server-side browser: the bytes come from the page itself.
 */
export async function captureCanvasThumbnail(options = {}) {
  const hidden = ['jiratack-overlay', 'jiratack-viewport-bar']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const previous = hidden.map((element) => element.style.visibility);
  hidden.forEach((element) => { element.style.visibility = 'hidden'; });

  const painted = () => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });

  // The preview is the TOP of the page, not the viewport at the pin (D43).
  // Remember where the reviewer was and put them back afterwards.
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // A tab capture is always the visible viewport, so both renderers start from
  // the top-left; html2canvas otherwise renders from wherever the reviewer had
  // scrolled, which produced an offset — and an offset image clipped by the card
  // looked like a cropped page.
  const viewportWidth = Math.max(320, document.documentElement.clientWidth || window.innerWidth);
  const viewportHeight = Math.max(200, window.innerHeight);

  try {
    window.scrollTo(0, 0);
    await painted();

    let dataUrl = null;
    if (typeof options.captureTab === 'function') {
      dataUrl = await options.captureTab();
    }
    if (!dataUrl) {
      // Full window width, exactly scaled to the stored width: no horizontal
      // clipping and nothing off-screen.
      const scale = Math.min(1, 480 / viewportWidth);
      const canvas = await html2canvas(document.documentElement, {
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
      });
      dataUrl = canvas && canvas.width > 0 ? canvas.toDataURL('image/jpeg', 0.6) : null;
    }
    return await downscaleDataUrl(dataUrl, 480);
  } catch (e) {
    return null;
  } finally {
    hidden.forEach((element, index) => {
      element.style.visibility = previous[index] || '';
    });
    window.scrollTo(scrollX, scrollY);
  }
}

/** Downscale any image data URL to the canvas-card size (D43 fallback). */
export async function thumbnailFromDataUrl(dataUrl, maxWidth = 480) {
  return downscaleDataUrl(dataUrl, maxWidth);
}
