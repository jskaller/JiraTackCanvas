import html2canvas from 'html2canvas';

const CROP_SIZE = 400;
const WEBP_QUALITY = 0.85;

export async function captureScreenshot(pinX, pinY) {
  const overlay = document.getElementById('jiratack-overlay');
  const previousVisibility = overlay ? overlay.style.visibility : null;
  if (overlay) overlay.style.visibility = 'hidden';

  try {
    const scale = window.devicePixelRatio || 1;

    const canvas = await html2canvas(document.documentElement, {
      scale,
      useCORS: true,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
    });

    const cropSize = Math.round(CROP_SIZE * scale);
    const centerX = (pinX - window.scrollX) * scale;
    const centerY = (pinY - window.scrollY) * scale;

    let sourceX = Math.round(centerX - cropSize / 2);
    let sourceY = Math.round(centerY - cropSize / 2);
    sourceX = Math.max(0, Math.min(sourceX, Math.max(0, canvas.width - cropSize)));
    sourceY = Math.max(0, Math.min(sourceY, Math.max(0, canvas.height - cropSize)));

    const sourceW = Math.max(1, Math.min(cropSize, canvas.width - sourceX));
    const sourceH = Math.max(1, Math.min(cropSize, canvas.height - sourceY));

    const output = document.createElement('canvas');
    output.width = CROP_SIZE;
    output.height = CROP_SIZE;

    const context = output.getContext('2d');
    if (!context) return null;

    context.drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, CROP_SIZE, CROP_SIZE);

    let dataUrl = output.toDataURL('image/webp', WEBP_QUALITY);
    if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
      dataUrl = output.toDataURL('image/png');
    }
    return dataUrl;
  } catch (e) {
    console.error('[JiraTack] screenshot failed', e);
    return null;
  } finally {
    if (overlay) overlay.style.visibility = previousVisibility || '';
  }
}
