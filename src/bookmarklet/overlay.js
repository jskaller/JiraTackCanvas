let overlayEl = null;

function make(tag, id, className) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  return node;
}

export function createOverlay() {
  removeOverlay();

  const overlay = make('div', 'jiratack-overlay');
  const pins = make('div', 'jiratack-pins');
  // Dedicated host for page previews, before the sidebar so it paints below it
  // and survives pin-layer re-renders (D35).
  const textPreviewHost = make('div', 'jiratack-text-preview-host');
  textPreviewHost.id = 'jiratack-text-preview-host';
  const capturePopoverHost = make('div', 'jiratack-capture-popover-host');
  capturePopoverHost.id = 'jiratack-capture-popover-host';
  const sidebar = make('aside', 'jiratack-sidebar');

  const header = make('div', null, 'jiratack-sidebar-header');
  const canvasSelector = make('div', null, 'jiratack-canvas-selector');
  const list = make('div', null, 'jiratack-ticket-list');
  const form = make('div', null, 'jiratack-new-ticket-form');
  const toast = make('div', 'jiratack-toast-container');

  sidebar.appendChild(header);
  sidebar.appendChild(canvasSelector);
  sidebar.appendChild(list);
  sidebar.appendChild(form);

  overlay.appendChild(pins);
  overlay.appendChild(textPreviewHost);
  overlay.appendChild(sidebar);
  overlay.appendChild(capturePopoverHost);
  overlay.appendChild(toast);

  // Mount on <html> rather than <body> so the Fit-page transform:scale on
  // <body> never scales the overlay, and so position:fixed stays viewport-anchored.
  document.documentElement.appendChild(overlay);
  overlayEl = overlay;

  return {
    overlayEl: overlay,
    pinsEl: pins,
    textPreviewHostEl: textPreviewHost,
    capturePopoverHostEl: capturePopoverHost,
    sidebarEl: sidebar,
    headerEl: header,
    canvasSelectorEl: canvasSelector,
    listEl: list,
    formEl: form,
    toastEl: toast,
  };
}

export function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
    return;
  }
  const existing = document.getElementById('jiratack-overlay');
  if (existing) existing.remove();
}
