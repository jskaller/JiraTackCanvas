import { createIssue, getIssueTypes, getPriorities, searchUsers } from './api.js';
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
  const { config, session, capture, onCancel, onCreated, defaultProject, defaultAssignee } = options;
  let screenshotDataUrl = options.screenshotDataUrl || null;
  let submitting = false;

  container.innerHTML = '';

  const form = el('form', 'jiratack-form');

  function field(labelText, control) {
    const wrap = el('div', 'jiratack-field');
    wrap.appendChild(el('span', 'jiratack-field-label', labelText));
    wrap.appendChild(control);
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
  const openMode = session.permittedProjects === '*';

  let projectSelect = null;
  let projectInput = null;

  if (!openMode && permitted.length > 0) {
    projectSelect = el('select', 'jiratack-input jiratack-select');
    const placeholder = el('option', null, 'Select project');
    placeholder.value = '';
    projectSelect.appendChild(placeholder);
    permitted.forEach((key) => {
      const option = el('option', null, key);
      option.value = key;
      projectSelect.appendChild(option);
    });

    const preferredProject = defaultProject && permitted.includes(defaultProject)
      ? defaultProject
      : (permitted.length === 1 ? permitted[0] : '');
    if (preferredProject) projectSelect.value = preferredProject;
  } else {
    projectInput = textInput('e.g. MM', defaultProject || '');
  }

  function getProjectKey() {
    if (projectSelect) return projectSelect.value.trim().toUpperCase();
    return projectInput ? projectInput.value.trim().toUpperCase() : '';
  }

  const issueTypeSelect = el('select', 'jiratack-input jiratack-select');
  issueTypeSelect.disabled = true;
  const initialTypeOption = el('option', null, 'Select a project first');
  initialTypeOption.value = '';
  issueTypeSelect.appendChild(initialTypeOption);

  const summaryInput = textInput('Short summary', '');
  summaryInput.maxLength = 215;

  const descriptionInput = el('textarea', 'jiratack-textarea');
  descriptionInput.rows = 5;
  descriptionInput.placeholder = 'Describe the issue…';

  form.appendChild(field('Project', projectSelect || projectInput));
  form.appendChild(field('Issue type', issueTypeSelect));
  form.appendChild(field('Summary', summaryInput));
  form.appendChild(field('Description', descriptionInput));

  const additional = el('details', 'jiratack-additional');
  additional.appendChild(el('summary', 'jiratack-additional-summary', 'Additional Fields'));

  const prioritySelect = el('select', 'jiratack-input jiratack-select');
  const noPriority = el('option', null, 'No priority');
  noPriority.value = '';
  prioritySelect.appendChild(noPriority);
  additional.appendChild(field('Priority', prioritySelect));

  const assigneeWrap = el('div', 'jiratack-field');
  assigneeWrap.appendChild(el('span', 'jiratack-field-label', 'Assignee'));
  const typeahead = el('div', 'jiratack-typeahead');
  const assigneeInput = textInput('Search by name', '');
  const typeaheadResults = el('div', 'jiratack-typeahead-results');
  typeaheadResults.style.display = 'none';
  typeahead.appendChild(assigneeInput);
  typeahead.appendChild(typeaheadResults);
  assigneeWrap.appendChild(typeahead);
  additional.appendChild(assigneeWrap);

  const parentInput = textInput('e.g. MM-123', '');
  additional.appendChild(field('Parent key (optional)', parentInput));

  let consoleCheckbox = null;
  const consoleSnapshot = capture && capture.consoleSnapshot ? capture.consoleSnapshot : [];
  if (consoleSnapshot.length > 0) {
    const wrap = el('label', 'jiratack-field jiratack-field-inline');
    consoleCheckbox = el('input', 'jiratack-checkbox');
    consoleCheckbox.type = 'checkbox';
    wrap.appendChild(consoleCheckbox);
    wrap.appendChild(el('span', 'jiratack-field-label', `Include console output (${consoleSnapshot.length} entries)`));
    additional.appendChild(wrap);
  }

  form.appendChild(additional);

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

  let issueTypesRequestId = 0;

  async function loadIssueTypes(projectKey) {
    issueTypesRequestId += 1;
    const requestId = issueTypesRequestId;

    const normalizedProject = String(projectKey || '').trim().toUpperCase();

    issueTypeSelect.innerHTML = '';
    const placeholder = el('option', null, normalizedProject ? 'Loading issue types…' : 'Select a project first');
    placeholder.value = '';
    issueTypeSelect.appendChild(placeholder);
    issueTypeSelect.disabled = true;

    if (!normalizedProject) return;

    try {
      const result = await getIssueTypes(config, session, normalizedProject);
      if (requestId !== issueTypesRequestId) return;

      const issueTypes = ((result && result.issueTypes) || []).filter((type) => !type.subtask);
      issueTypeSelect.innerHTML = '';

      if (issueTypes.length === 0) {
        const empty = el('option', null, 'No issue types available');
        empty.value = '';
        issueTypeSelect.appendChild(empty);
        return;
      }

      issueTypes.forEach((type) => {
        const option = el('option', null, type.name);
        option.value = String(type.id);
        issueTypeSelect.appendChild(option);
      });

      issueTypeSelect.value = String(issueTypes[0].id);
      issueTypeSelect.disabled = false;
    } catch (e) {
      if (requestId !== issueTypesRequestId) return;
      const message = (e && e.message) || 'Failed to load issue types.';
      issueTypeSelect.innerHTML = '';
      const failed = el('option', null, message);
      failed.value = '';
      issueTypeSelect.appendChild(failed);
      issueTypeSelect.disabled = true;
      showError(message);
    }
  }

  (async () => {
    try {
      const result = await getPriorities(config, session);
      const priorities = (result && result.priorities) || [];
      priorities.forEach((priority) => {
        const option = el('option', null, priority.name);
        option.value = String(priority.id);
        prioritySelect.appendChild(option);
      });
    } catch (e) {
      // Priority is optional; leave only "No priority"
    }
  })();

  let assigneeAccountId = defaultAssignee && defaultAssignee.accountId
    ? String(defaultAssignee.accountId)
    : null;
  if (defaultAssignee) {
    assigneeInput.value = defaultAssignee.displayName || defaultAssignee.accountId || '';
  }

  let assigneeDebounce = null;
  let assigneeRequestId = 0;

  function hideTypeahead() {
    typeaheadResults.innerHTML = '';
    typeaheadResults.style.display = 'none';
  }

  function renderTypeahead(users) {
    typeaheadResults.innerHTML = '';
    if (!users || users.length === 0) {
      hideTypeahead();
      return;
    }
    typeaheadResults.style.display = 'block';
    users.forEach((user) => {
      const item = el('div', 'jiratack-typeahead-item', user.displayName || user.accountId);
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        assigneeAccountId = user.accountId;
        assigneeInput.value = user.displayName || user.accountId;
        hideTypeahead();
      });
      typeaheadResults.appendChild(item);
    });
  }

  assigneeInput.addEventListener('input', () => {
    assigneeAccountId = null;
    if (assigneeDebounce) {
      window.clearTimeout(assigneeDebounce);
      assigneeDebounce = null;
    }

    const query = assigneeInput.value.trim();
    if (query.length === 0) {
      hideTypeahead();
      return;
    }

    assigneeDebounce = window.setTimeout(async () => {
      assigneeDebounce = null;
      const projectKey = getProjectKey();
      if (!projectKey) {
        hideTypeahead();
        return;
      }
      assigneeRequestId += 1;
      const requestId = assigneeRequestId;
      try {
        const result = await searchUsers(config, session, projectKey, query);
        if (requestId !== assigneeRequestId) return;
        renderTypeahead((result && result.users) || []);
      } catch (e) {
        hideTypeahead();
      }
    }, 300);
  });

  assigneeInput.addEventListener('blur', () => {
    window.setTimeout(hideTypeahead, 150);
  });

  function onProjectChanged() {
    const key = getProjectKey();
    if (projectInput && key) projectInput.value = key;
    hideTypeahead();
    loadIssueTypes(key);
  }

  if (projectSelect) {
    projectSelect.addEventListener('change', onProjectChanged);
  } else if (projectInput) {
    let projectDebounce = null;
    projectInput.addEventListener('input', () => {
      if (projectDebounce) window.clearTimeout(projectDebounce);
      projectDebounce = window.setTimeout(() => {
        projectDebounce = null;
        loadIssueTypes(getProjectKey());
      }, 400);
    });
    projectInput.addEventListener('blur', () => {
      if (projectDebounce) {
        window.clearTimeout(projectDebounce);
        projectDebounce = null;
      }
      onProjectChanged();
    });
  }

  const initialProject = getProjectKey();
  if (initialProject) {
    loadIssueTypes(initialProject);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    clearError();

    const summary = summaryInput.value.trim();
    const projectKey = getProjectKey();
    const issueTypeId = issueTypeSelect.value.trim();
    const parentKey = parentInput.value.trim();

    if (!projectKey) {
      showError('Select a project.');
      return;
    }
    if (summary.length < 3) {
      showError('Summary must be at least 3 characters.');
      return;
    }
    if (!issueTypeId) {
      showError('Select an issue type.');
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
        priorityId: prioritySelect.value || null,
        assigneeAccountId: assigneeAccountId || null,
        parentKey: parentKey || null,
      });

      destroy();
      if (onCreated) onCreated({ result, capture, summary });
    } catch (err) {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create ticket';
      const code = err && err.code ? `${err.code}: ` : '';
      let message = `${code}${(err && err.message) || 'Failed to create ticket.'}`;
      if (err && err.details) {
        try {
          message += ` — ${JSON.stringify(err.details)}`;
        } catch (e) {
          message += ` — ${String(err.details)}`;
        }
      }
      showError(message);
    }
  }

  form.addEventListener('submit', handleSubmit);

  function destroy() {
    if (assigneeDebounce) {
      window.clearTimeout(assigneeDebounce);
      assigneeDebounce = null;
    }
    issueTypesRequestId += 1;
    assigneeRequestId += 1;
    container.innerHTML = '';
  }

  return { destroy };
}
