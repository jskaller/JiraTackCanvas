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

export async function captureScreenshot(clientX, clientY) {
  const overlay = document.getElementById('jiratack-overlay');
  const previousVisibility = overlay ? overlay.style.visibility : null;
  if (overlay) overlay.style.visibility = 'hidden';

  try {
    const scale = window.devicePixelRatio || 1;
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

    let dataUrl = output.toDataURL('image/webp', WEBP_QUALITY);
    if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
      dataUrl = output.toDataURL('image/png');
    }
    console.log('[JiraTack] Screenshot captured successfully');
    return dataUrl;
  } catch (e) {
    console.log('[JiraTack] Screenshot failed', e);
    return null;
  } finally {
    if (overlay) overlay.style.visibility = previousVisibility || '';
  }
}
