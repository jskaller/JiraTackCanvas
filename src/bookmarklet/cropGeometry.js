/**
 * Crop geometry for tab captures (pure, no DOM).
 *
 * A tab capture is the screen, including JiraTack's own sidebar. The sidebar is
 * deliberately never hidden (hiding it made the panel blink for as long as a
 * capture took), so it is measured and either cropped out of the shot or masked
 * inside the crop.
 */

/**
 * Fill the part of the output that came from `rect` (in source/CSS coordinates).
 *
 * @param {{fillStyle: string, fillRect: Function}} context output 2D context
 * @param {{left:number, top:number, right:number, bottom:number}|null} rect
 * @param {{left:number, top:number, right:number, bottom:number}} source
 * @param {{width:number, height:number}} output
 * @returns {boolean} whether anything was masked
 */
export function maskRect(context, rect, source, output) {
  if (!rect || !context || !source || !output) return false;

  const left = Math.max(source.left, rect.left);
  const right = Math.min(source.right, rect.right);
  const top = Math.max(source.top, rect.top);
  const bottom = Math.min(source.bottom, rect.bottom);
  if (right <= left || bottom <= top) return false;

  const sourceWidth = source.right - source.left;
  const sourceHeight = source.bottom - source.top;
  if (sourceWidth <= 0 || sourceHeight <= 0) return false;

  const scaleX = output.width / sourceWidth;
  const scaleY = output.height / sourceHeight;

  context.fillStyle = '#ffffff';
  context.fillRect(
    (left - source.left) * scaleX,
    (top - source.top) * scaleY,
    (right - left) * scaleX,
    (bottom - top) * scaleY,
  );
  return true;
}
