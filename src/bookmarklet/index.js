const LOG_PREFIX = '[JiraTack]';

function close() {
  window.__jiratackActiveCanvas = null;
  console.log(`${LOG_PREFIX} Close called`);
}

function init(config) {
  const canvasId = (config && config.canvasId) || null;
  const canvasName = (config && (config.canvasName || config.canvasId)) || 'unknown';

  if (canvasId && window.__jiratackActiveCanvas === canvasId) {
    window.__jiratackClose();
    return;
  }

  window.__jiratackActiveCanvas = canvasId;
  console.log(`${LOG_PREFIX} Init called with canvas: ${canvasName}`);
}

window.__jiratackInit = init;
window.__jiratackClose = close;
