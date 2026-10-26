import { createIssue } from './api.js';
import { serializeToAdf } from '../shared/adfSerializer.js';
import { formatConsoleLog } from './consoleProxy.js';

const PARENT_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function descriptionToAdf(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const content = text.split('\n').map((line) => {
    if (line.length === 0) return { type: 'paragraph' };
    return { type: 'paragraph', content: [{ type: 'text', text: line }] };
  });
  return serializeToAdf({ type: 'doc', content });
}

export function renderTicketForm(container, options) {
  const { config, session, capture, onCancel, onCreated } = options;
  let screenshotDataUrl = options.screenshotDataUrl || null;
  let submitting = false;

  container.innerHTML = '';

  const form = el('form', 'jiratack-form');

  function field(labelText, input) {
    const wrap = el('label', 'jiratack-field');
    wrap.appendChild(el('span', 'jiratack-field-label', labelText));
    wrap.appendChild(input);
    return wrap;
  }

  function textInput(placeholder, value) {
    const input = el('input', 'jiratack-input');
    input.type = 'text';
    input.placeholder = placeholder || '';
    input.value = value || '';
    return input;
  }

  const permitted = Array.isArray(session.permittedProjects) ? session.permittedProjects : [];
  const defaultProject = permitted.length === 1 ? permitted[0] : '';

  const projectInput = textInput('e.g. MM', defaultProject);
  const issueTypeInput = textInput('e.g. 10001', '');
  const summaryInput = textInput('Short summary', '');
  summaryInput.maxLength = 215;
  const descriptionInput = el('textarea', 'jiratack-textarea');
  descriptionInput.rows = 5;
  descriptionInput.placeholder = 'Describe the issue…';
  const parentInput = textInput('e.g. MM-123', '');

  form.appendChild(field('Project key', projectInput));
  form.appendChild(field('Issue type ID', issueTypeInput));
  form.appendChild(field('Summary', summaryInput));
  form.appendChild(field('Description', descriptionInput));
  form.appendChild(field('Parent key (optional)', parentInput));

  let consoleCheckbox = null;
  const consoleSnapshot = capture && capture.consoleSnapshot ? capture.consoleSnapshot : [];
  if (consoleSnapshot.length > 0) {
    const wrap = el('label', 'jiratack-field jiratack-field-inline');
    consoleCheckbox = el('input', 'jiratack-checkbox');
    consoleCheckbox.type = 'checkbox';
    wrap.appendChild(consoleCheckbox);
    wrap.appendChild(el('span', 'jiratack-field-label', `Include console output (${consoleSnapshot.length} entries)`));
    form.appendChild(wrap);
  }

  const preview = el('div', 'jiratack-screenshot');

  function renderPreview() {
    preview.innerHTML = '';
    if (!screenshotDataUrl) {
      preview.style.display = 'none';
      return;
    }
    preview.style.display = 'block';
    const img = el('img', 'jiratack-screenshot-preview');
    img.src = screenshotDataUrl;
    img.alt = 'Screenshot preview';
    const remove = el('button', 'jiratack-screenshot-remove', '✕ Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      screenshotDataUrl = null;
      renderPreview();
    });
    preview.appendChild(img);
    preview.appendChild(remove);
  }

  form.appendChild(preview);
  renderPreview();

  const errorBox = el('div', 'jiratack-form-error');
  errorBox.style.display = 'none';
  form.appendChild(errorBox);

  const actions = el('div', 'jiratack-form-actions');
  const submitButton = el('button', 'jiratack-button jiratack-button-primary', 'Create ticket');
  submitButton.type = 'submit';
  const cancelButton = el('button', 'jiratack-button', 'Cancel');
  cancelButton.type = 'button';
  cancelButton.addEventListener('click', () => {
    destroy();
    if (onCancel) onCancel();
  });
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  container.appendChild(form);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.style.display = 'none';
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    clearError();

    const summary = summaryInput.value.trim();
    const projectKey = projectInput.value.trim();
    const issueTypeId = issueTypeInput.value.trim();
    const parentKey = parentInput.value.trim();

    if (summary.length < 3) {
      showError('Summary must be at least 3 characters.');
      return;
    }
    if (!projectKey) {
      showError('Project key is required.');
      return;
    }
    if (!issueTypeId) {
      showError('Issue type ID is required.');
      return;
    }
    if (parentKey && !PARENT_KEY_RE.test(parentKey)) {
      showError('Parent key must look like MM-123.');
      return;
    }

    const consoleLog = consoleCheckbox && consoleCheckbox.checked
      ? formatConsoleLog(consoleSnapshot)
      : null;

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    try {
      const result = await createIssue(config, session, {
        canvasId: config.canvasId,
        url: window.location.href,
        pinPosition: capture.pinPosition,
        selector: capture.selector || null,
        summary,
        descriptionAdf: descriptionToAdf(descriptionInput.value),
        screenshotDataUrl,
        consoleLog,
        issueTypeId,
        projectKey,
        priorityId: null,
        assigneeAccountId: null,
        parentKey: parentKey || null,
      });

      destroy();
      if (onCreated) onCreated({ result, capture, summary });
    } catch (err) {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create ticket';
      const code = err && err.code ? `${err.code}: ` : '';
      showError(`${code}${(err && err.message) || 'Failed to create ticket.'}`);
    }
  }

  form.addEventListener('submit', handleSubmit);

  function destroy() {
    container.innerHTML = '';
  }

  return { destroy };
}
