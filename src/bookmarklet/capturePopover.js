import { placePopover } from './popoverGeometry.js';

/**
 * The anchored capture composer (D36).
 *
 * Pin: Summary + Description, then "Add to ticket" hands the content to the
 * sidebar, where the Jira fields live.
 *
 * Text: original quote + replacement + a preview switch, then "Add to ticket"
 * (or "Save" when editing from the sidebar).
 *
 * It never creates a ticket; the sidebar's Create does.
 */
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function field(labelText, control) {
  const wrap = make('label', 'jiratack-capture-field');
  wrap.appendChild(make('span', 'jiratack-field-label', labelText));
  wrap.appendChild(control);
  return wrap;
}

function cardShell(host, titleText) {
  const card = make('div', 'jiratack-capture-popover');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', titleText);
  const title = make('div', 'jiratack-capture-title', titleText);
  card.appendChild(title);
  host.appendChild(card);
  return card;
}

function positionCard(card, anchor) {
  const rect = card.getBoundingClientRect();
  const spot = placePopover({
    anchor,
    size: { width: rect.width || 340, height: rect.height || 200 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gap: 10,
  });
  card.style.left = `${spot.left}px`;
  card.style.top = `${spot.top}px`;
}

function actions(card, submitLabel, onSubmit, onCancel) {
  const row = make('div', 'jiratack-capture-actions');
  const submit = make('button', 'jiratack-button jiratack-button-primary', submitLabel);
  submit.type = 'button';
  const cancel = make('button', 'jiratack-button', 'Cancel');
  cancel.type = 'button';
  submit.addEventListener('click', onSubmit);
  cancel.addEventListener('click', onCancel);
  row.appendChild(submit);
  row.appendChild(cancel);
  card.appendChild(row);
  return { submit, cancel };
}

function errorLine(card) {
  const error = make('div', 'jiratack-capture-error');
  error.style.display = 'none';
  card.appendChild(error);
  return {
    show(message) {
      error.textContent = message;
      error.style.display = 'block';
    },
    clear() {
      error.textContent = '';
      error.style.display = 'none';
    },
  };
}

function makeSwitch(labelText) {
  const button = make('button', 'jiratack-switch jiratack-capture-switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', 'false');
  button.appendChild(make('span', 'jiratack-switch-label', labelText));
  const track = make('span', 'jiratack-switch-track');
  track.appendChild(make('span', 'jiratack-switch-knob'));
  button.appendChild(track);
  return button;
}


export function openPinPopover(options = {}) {
  const { host, anchor, initialSummary = '', initialDescription = '', onAdd, onCancel } = options;
  if (!host) return null;

  const card = cardShell(host, 'New ticket');
  card.dataset.kind = 'pin';
  card.style.visibility = 'hidden';

  const summary = make('input', 'jiratack-input jiratack-input-primary');
  summary.type = 'text';
  summary.maxLength = 215;
  summary.placeholder = 'Pin Summary';
  summary.value = initialSummary || '';
  const description = make('textarea', 'jiratack-textarea');
  description.rows = 4;
  description.placeholder = 'Detailed Description';
  description.value = initialDescription || '';

  card.appendChild(field('Summary', summary));
  card.appendChild(field('Description', description));
  const error = errorLine(card);

  let closed = false;
  function destroy() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
    card.remove();
  }
  function cancel() {
    if (closed) return;
    destroy();
    if (onCancel) onCancel();
  }
  function submit() {
    if (closed) return;
    error.clear();
    const summaryValue = summary.value.trim();
    if (summaryValue.length < 3) {
      error.show('Summary must be at least 3 characters.');
      summary.focus();
      return;
    }
    const values = { summary: summaryValue, description: description.value };
    destroy();
    if (onAdd) onAdd(values);
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }
  function reposition() {
    if (!closed) positionCard(card, anchor);
  }

  actions(card, 'Add to ticket', submit, cancel);
  card.style.visibility = '';
  positionCard(card, anchor);
  summary.focus({ preventScroll: true });
  if (summary.value) summary.select();
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', reposition);

  return { destroy, element: card };
}

export function openTextPopover(options = {}) {
  const {
    host,
    anchor,
    selection,
    initialReplacement = '',
    preview,
    submitLabel = 'Add to ticket',
    onAdd,
    onCancel,
  } = options;
  if (!host || !selection) return null;

  const editing = submitLabel === 'Save';
  const card = cardShell(host, editing ? 'Edit suggestion' : 'Suggest an edit');
  card.dataset.kind = 'text';
  card.style.visibility = 'hidden';

  const original = make('div', 'jiratack-capture-original', String(selection.text || '').trim());
  original.title = 'The text you selected on the page';
  card.appendChild(original);

  const replacement = make('textarea', 'jiratack-textarea jiratack-capture-replacement');
  replacement.rows = 2;
  replacement.maxLength = 2000;
  replacement.placeholder = 'What should it say instead?';
  replacement.value = initialReplacement || '';
  card.appendChild(field('Suggested text', replacement));

  const row = make('div', 'jiratack-capture-preview-row');
  const toggle = makeSwitch('View on page');
  row.appendChild(toggle);
  card.appendChild(row);
  const error = errorLine(card);

  let closed = false;
  let previewOn = false;

  function setSwitch(on) {
    previewOn = on;
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    toggle.classList.toggle('jiratack-switch-on', on);
  }

  function hidePreview() {
    if (preview) preview.hide();
    setSwitch(false);
  }

  function showPreview() {
    if (!preview) return;
    const value = replacement.value.trim();
    if (!value) {
      error.show('Write the replacement first.');
      return;
    }
    const mode = preview.show({
      text: selection.text,
      range: selection.range,
      anchor: selection.anchor,
      replacement: value,
    });
    if (!mode) {
      setSwitch(false);
      error.show('This selection can no longer be previewed on the page.');
      return;
    }
    error.clear();
    setSwitch(true);
  }

  toggle.addEventListener('click', () => {
    if (previewOn) {
      hidePreview();
    } else {
      showPreview();
    }
  });

  replacement.addEventListener('input', () => {
    if (previewOn) {
      if (!replacement.value.trim()) hidePreview();
      else showPreview();
    }
  });

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    closed = true;
    hidePreview();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
    card.remove();
  }
  function cancel() {
    if (closed) return;
    destroy();
    if (onCancel) onCancel();
  }
  function submit() {
    if (closed) return;
    error.clear();
    const value = replacement.value.trim();
    if (!value) {
      error.show('Write the replacement first.');
      replacement.focus();
      return;
    }
    hidePreview();
    destroy();
    if (onAdd) onAdd({ replacement: value });
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  }
  function reposition() {
    if (!closed) positionCard(card, anchor);
  }

  actions(card, submitLabel, submit, cancel);
  card.style.visibility = '';
  positionCard(card, anchor);
  replacement.focus({ preventScroll: true });
  if (replacement.value) replacement.select();
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', reposition);

  return { destroy, element: card, isPreviewOn: () => previewOn };
}
