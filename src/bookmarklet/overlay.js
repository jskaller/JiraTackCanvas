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
  const sidebar = make('aside', 'jiratack-sidebar');

  const header = make('div', null, 'jiratack-sidebar-header');
  const list = make('div', null, 'jiratack-ticket-list');
  const form = make('div', null, 'jiratack-new-ticket-form');
  const toast = make('div', 'jiratack-toast-container');

  sidebar.appendChild(header);
  sidebar.appendChild(list);
  sidebar.appendChild(form);

  overlay.appendChild(pins);
  overlay.appendChild(sidebar);
  overlay.appendChild(toast);

  document.body.appendChild(overlay);
  overlayEl = overlay;

  return {
    overlayEl: overlay,
    pinsEl: pins,
    sidebarEl: sidebar,
    headerEl: header,
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
