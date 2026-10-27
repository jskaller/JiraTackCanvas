import html2canvas from 'html2canvas';

const CROP_SIZE = 400;
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

    const canvas = await html2canvas(document.documentElement, {
      scale,
      useCORS: true,
      logging: false,
      x: documentX - CROP_SIZE / 2,
      y: documentY - CROP_SIZE / 2,
      width: CROP_SIZE,
      height: CROP_SIZE,
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    const output = document.createElement('canvas');
    output.width = CROP_SIZE;
    output.height = CROP_SIZE;

    const context = output.getContext('2d');
    if (!context) return null;

    context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, CROP_SIZE, CROP_SIZE);
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
