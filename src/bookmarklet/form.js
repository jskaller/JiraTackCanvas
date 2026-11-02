function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

import {
  createIssue,
  getIssueTypes,
  getPriorities,
  searchUsers,
  uploadScreenshot,
  uploadAttachment,
  getAttachmentLimits,
} from './api.js';
import { getLastSelection } from './selection.js';
import { serializeToAdf } from '../shared/adfSerializer.js';
import { normalizeUrl, stripDeepLinkParams } from '../shared/urlNormalize.js';
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
  const { config, session, capture, onCancel, onCreated, defaultProject, defaultAssignee, defaultIssueTypeId, defaultPriorityId, pins } = options;
  const isGuest = Boolean(session && session.scope === 'guest_create');
  const guestNameInput = isGuest ? textInput('Your name', (session && session.guestName) || '') : null;
  const guestEmailInput = isGuest ? textInput('you@example.com', (session && session.guestEmail) || '') : null;
  if (guestNameInput) {
    guestNameInput.disabled = true;
    guestNameInput.title = 'Set by the person who invited you.';
  }
  if (guestEmailInput) {
    guestEmailInput.disabled = true;
    guestEmailInput.title = 'Set by the person who invited you.';
  }
  let screenshotDataUrl = options.screenshotDataUrl || null;
  let submitting = false;
  const pageUrl = normalizeUrl(stripDeepLinkParams(window.location.href));

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

  const existingPins = Array.isArray(options.pins) ? options.pins : [];
  const isSeedTicket = (pin) => Boolean(pin)
    && typeof pin.summary === 'string'
    && pin.summary.replace(/^\[JiraTack\]\s*/i, '').trim() === 'Canvas created';
  const newestPin = existingPins.length > 0
    ? existingPins.reduce((newest, pin) => {
        if (!newest) return pin;
        const newestTime = newest.createdAt ? Date.parse(newest.createdAt) : 0;
        const pinTime = pin.createdAt ? Date.parse(pin.createdAt) : 0;
        return pinTime > newestTime ? pin : newest;
      }, null)
    : null;
  // The canvas seed ticket is an Epic; it must never drive the issue-type default.
  const usablePins = existingPins.filter((pin) => pin && !isSeedTicket(pin));
  const lastUsedPin = usablePins.length > 0
    ? usablePins.reduce((newest, pin) => {
        if (!newest) return pin;
        const newestTime = newest.createdAt ? Date.parse(newest.createdAt) : 0;
        const pinTime = pin.createdAt ? Date.parse(pin.createdAt) : 0;
        return pinTime > newestTime ? pin : newest;
      }, null)
    : null;

  const resolvedDefaultProject = (newestPin && newestPin.projectKey)
    || (permitted.length > 0 ? permitted[0] : '');
  const resolvedDefaultIssueTypeId = (lastUsedPin && lastUsedPin.issueTypeId)
    || defaultIssueTypeId
    || null;
  const resolvedDefaultPriorityId = newestPin && newestPin.priorityId ? newestPin.priorityId : null;

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

    const preferredProject = resolvedDefaultProject && permitted.includes(resolvedDefaultProject)
      ? resolvedDefaultProject
      : (permitted.length === 1 ? permitted[0] : '');
    if (preferredProject) projectSelect.value = preferredProject;
  } else {
    projectInput = textInput('e.g. MM', resolvedDefaultProject || '');
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
  descriptionInput.rows = 3;
  descriptionInput.placeholder = 'Describe the issue…';

  const assigneeWrap = el('div', 'jiratack-field');
  assigneeWrap.appendChild(
    el('span', 'jiratack-field-label', isGuest ? 'Assign To (Licensed User)' : 'Assignee'),
  );
  const typeahead = el('div', 'jiratack-typeahead');
  const assigneeInput = textInput('Search by name', '');
  const typeaheadResults = el('div', 'jiratack-typeahead-results');
  typeaheadResults.style.display = 'none';
  typeahead.appendChild(assigneeInput);
  typeahead.appendChild(typeaheadResults);
  assigneeWrap.appendChild(typeahead);

  const reporterInput = textInput('', session.displayName || 'Current user');
  reporterInput.disabled = true;
  reporterInput.title = 'Reporter is set from the authenticated Jira user.';

  const topBar = el('div', 'jiratack-form-top');
  topBar.appendChild(el('span', 'jiratack-form-title', 'New ticket'));
  const topCancelButton = el('button', 'jiratack-form-cancel', 'Cancel');
  topCancelButton.type = 'button';
  topCancelButton.title = 'Cancel (Esc)';
  topCancelButton.addEventListener('click', cancel);
  topBar.appendChild(topCancelButton);
  form.appendChild(topBar);

  if (isGuest) {
    const missingIdentity = !(session && session.guestName && session.guestEmail);
    if (missingIdentity) {
      form.appendChild(el(
        'div',
        'jiratack-form-warning',
        'This invitation is missing the reviewer identity. Ask the person who sent it for a new link.',
      ));
    }
    form.appendChild(field('Your Name', guestNameInput));
    form.appendChild(field('Your Email', guestEmailInput));
  }
  form.appendChild(field('Project', projectSelect || projectInput));
  form.appendChild(field('Issue type', issueTypeSelect));
  form.appendChild(assigneeWrap);
  if (!isGuest) {
    form.appendChild(field('Reporter', reporterInput));
  }
  form.appendChild(field('Summary', summaryInput));
  form.appendChild(field('Description', descriptionInput));

  const additional = el('details', 'jiratack-additional');
  additional.appendChild(el('summary', 'jiratack-additional-summary', 'Additional Fields'));

  const prioritySelect = el('select', 'jiratack-input jiratack-select');
  const noPriority = el('option', null, 'No priority');
  noPriority.value = '';
  prioritySelect.appendChild(noPriority);
  additional.appendChild(field('Priority', prioritySelect));

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

  // Text-edit suggestion (plan 6.4). Seeded from the page selection so the
  // common case — highlight the wrong copy, then file it — needs no typing of
  // the original.
  const textEditBox = el('div', 'jiratack-textedit');
  textEditBox.appendChild(el('span', 'jiratack-field-label', 'Suggest a text change (optional)'));
  const textEditOriginal = el('textarea', 'jiratack-textarea');
  textEditOriginal.placeholder = 'Original text (select it on the page first)';
  const textEditReplacement = el('textarea', 'jiratack-textarea');
  textEditReplacement.placeholder = 'Suggested replacement';
  // Read the stored selection, not the live one: the click that placed the pin
  // already collapsed it.
  const selected = getLastSelection();
  if (selected) textEditOriginal.value = selected;
  textEditBox.appendChild(textEditOriginal);
  textEditBox.appendChild(textEditReplacement);
  form.appendChild(textEditBox);

  // Screen recording (plan 6.5). WebM because Chrome and Firefox both produce
  // it; MP4 would fork the pipeline and Jira's previewer is not the only
  // consumer — our issue panel plays it from attachment content.
  let videoBlob = null;
  const videoBox = el('div', 'jiratack-video');
  const videoButton = el('button', 'jiratack-button', 'Record screen (up to 60s)');
  videoButton.type = 'button';
  const videoStatus = el('div', 'jiratack-form-hint', '');
  const videoPreview = el('video', 'jiratack-video-preview');
  videoPreview.controls = true;
  videoPreview.style.display = 'none';
  videoPreview.style.maxWidth = '100%';
  videoBox.appendChild(videoButton);
  videoBox.appendChild(videoStatus);
  videoBox.appendChild(videoPreview);
  form.appendChild(videoBox);

  videoButton.addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      showError('Screen recording is not available in this browser.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch (e) {
      return; // the picker was dismissed
    }
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      stream.getTracks().forEach((track) => track.stop());
      showError('This browser cannot record WebM.');
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1500000 });
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      videoBlob = new Blob(chunks, { type: 'video/webm' });
      videoPreview.src = URL.createObjectURL(videoBlob);
      videoPreview.style.display = 'block';
      videoStatus.textContent = `Recorded ${(videoBlob.size / 1024 / 1024).toFixed(1)} MB`;
      videoButton.disabled = false;
      window.clearTimeout(stopTimer);
    });
    recorder.start();
    videoButton.disabled = true;
    videoStatus.textContent = 'Recording… stops after 60 seconds.';
    const stopTimer = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 60000);
  });

  // Attachments. No type allowlist: Jira decides what it accepts, and the size
  // ceiling comes from Jira's own attachment metadata rather than a guess.
  const attachmentsBox = el('div', 'jiratack-attachments');
  const attachmentLabel = el('label', 'jiratack-field');
  attachmentLabel.appendChild(el('span', 'jiratack-field-label', 'Attach files'));
  const attachmentInput = el('input', 'jiratack-attachment-input');
  attachmentInput.type = 'file';
  attachmentInput.multiple = true;
  attachmentLabel.appendChild(attachmentInput);
  const attachmentNote = el('div', 'jiratack-form-hint', '');
  attachmentsBox.appendChild(attachmentLabel);
  attachmentsBox.appendChild(attachmentNote);
  form.appendChild(attachmentsBox);

  let attachmentLimit = 0;
  getAttachmentLimits(config, session).then((limits) => {
    if (!limits || !limits.uploadLimit) return;
    attachmentLimit = limits.uploadLimit;
    const mb = Math.round(limits.uploadLimit / (1024 * 1024));
    attachmentNote.textContent = `Up to ${mb} MB per file, as set by Jira.`;
  }).catch(() => {
    // Limits are advisory; the server still enforces Jira's rule.
  });

  if (options.screenshotFailed) {
    form.appendChild(
      el(
        'div',
        'jiratack-form-warning',
        'Screenshot could not be captured due to site security. Ticket will be created without an image.',
      ),
    );
  }

  const errorBox = el('div', 'jiratack-form-error');
  errorBox.style.display = 'none';
  form.appendChild(errorBox);

  const actions = el('div', 'jiratack-form-actions');
  const submitButton = el('button', 'jiratack-button jiratack-button-primary', 'Create ticket');
  submitButton.type = 'submit';
  const cancelButton = el('button', 'jiratack-button', 'Cancel');
  cancelButton.type = 'button';
  cancelButton.addEventListener('click', cancel);
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  container.appendChild(form);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function cancel() {
    destroy();
    if (onCancel) onCancel();
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  document.addEventListener('keydown', onKeydown, true);

  function clearError() {
    errorBox.textContent = '';
    errorBox.style.display = 'none';
  }

  let issueTypesRequestId = 0;

  async function loadIssueTypes(projectKey, options = {}) {
    const silent = Boolean(options.silent);
    issueTypesRequestId += 1;
    const requestId = issueTypesRequestId;

    if (!silent) clearError();
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

      if (resolvedDefaultIssueTypeId && issueTypes.some((type) => String(type.id) === String(resolvedDefaultIssueTypeId))) {
        issueTypeSelect.value = String(resolvedDefaultIssueTypeId);
      } else {
        // Last used, then Task, then anything that is not an Epic.
        const preferred = issueTypes.find((type) => /^task$/i.test(type.name))
          || issueTypes.find((type) => !/^epic$/i.test(type.name))
          || issueTypes[0];
        issueTypeSelect.value = String(preferred.id);
      }
      issueTypeSelect.disabled = false;
    } catch (e) {
      if (requestId !== issueTypesRequestId) return;
      const message = (e && e.message) || 'Failed to load issue types.';
      issueTypeSelect.innerHTML = '';
      const failed = el('option', null, silent ? 'Select a project first' : message);
      failed.value = '';
      issueTypeSelect.appendChild(failed);
      issueTypeSelect.disabled = true;
      if (silent) {
        clearError();
      } else {
        showError(message);
      }
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
      if (resolvedDefaultPriorityId && priorities.some((p) => String(p.id) === String(resolvedDefaultPriorityId))) {
        prioritySelect.value = String(resolvedDefaultPriorityId);
      } else {
        const preferred = priorities.find((p) => /^medium$/i.test(p.name)) || priorities[0];
        if (preferred) prioritySelect.value = String(preferred.id);
      }
    } catch (e) {
      // Priority is optional; leave only "No priority"
    }
  })();

  const initialAssignee = defaultAssignee;
  let assigneeAccountId = initialAssignee && initialAssignee.accountId
    ? String(initialAssignee.accountId)
    : null;
  if (initialAssignee) {
    assigneeInput.value = initialAssignee.displayName || initialAssignee.accountId || '';
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
    projectInput.addEventListener('blur', onProjectChanged);
  }

  clearError();
  const initialProject = getProjectKey();
  if (initialProject) {
    loadIssueTypes(initialProject, { silent: true });
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

    if (isGuest && !assigneeAccountId) {
      showError('Select a licensed user to assign this ticket to.');
      return;
    }

    const consoleLog = consoleCheckbox && consoleCheckbox.checked
      ? formatConsoleLog(consoleSnapshot)
      : null;

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    try {
      const originalText = textEditOriginal.value.trim();
      const replacementText = textEditReplacement.value.trim();
      let descriptionText = descriptionInput.value;
      if (originalText && replacementText) {
        descriptionText = `Text change\nOriginal: ${originalText}\nSuggested: ${replacementText}\n\n${descriptionText}`;
        if (!summaryInput.value.trim()) {
          summaryInput.value = `Text edit: ${originalText.slice(0, 60)}`;
        }
      }
      const descriptionAdf = descriptionToAdf(descriptionText);

      let screenshotUploadId = null;
      if (screenshotDataUrl) {
        try {
          screenshotUploadId = await uploadScreenshot(config, session, screenshotDataUrl);
        } catch (e) {
          // Screenshots are optional; never block the ticket on upload failure.
          console.error('[JiraTack] Screenshot upload failed:', e);
        }
      }

      const attachmentIds = [];
      const files = Array.from(attachmentInput.files || []);
      for (const file of files) {
        if (attachmentLimit && file.size > attachmentLimit) {
          const mb = Math.round(attachmentLimit / (1024 * 1024));
          throw new Error(`${file.name} is larger than Jira allows (${mb} MB).`);
        }
        const dataUrl = await readFileAsDataUrl(file);
        const uploadId = await uploadAttachment(config, session, {
          dataUrl,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        if (uploadId) attachmentIds.push(uploadId);
      }

      if (videoBlob) {
        if (attachmentLimit && videoBlob.size > attachmentLimit) {
          const mb = Math.round(attachmentLimit / (1024 * 1024));
          throw new Error(`The recording is larger than Jira allows (${mb} MB).`);
        }
        const videoDataUrl = await readFileAsDataUrl(videoBlob);
        const videoUploadId = await uploadAttachment(config, session, {
          dataUrl: videoDataUrl,
          filename: `jiratack-recording-${Date.now()}.webm`,
          mimeType: 'video/webm',
        });
        if (videoUploadId) attachmentIds.push(videoUploadId);
      }

      const result = await createIssue(config, session, {
        canvasId: config.canvasId,
        url: pageUrl,
        pinPosition: capture.pinPosition,
        selector: capture.selector || null,
        captureContext: capture.captureContext || null,
        summary,
        descriptionAdf,
        screenshotUploadId,
        attachmentUploadIds: attachmentIds,
        consoleLog,
        issueTypeId,
        projectKey,
        priorityId: prioritySelect.value || null,
        assigneeAccountId: assigneeAccountId || null,
        parentKey: parentKey || null,
      });

      destroy();
      if (onCreated) {
        onCreated({
          result,
          capture,
          summary,
          projectKey,
          issueTypeId,
          priorityId: prioritySelect.value || null,
          assignee: assigneeAccountId
            ? {
              accountId: assigneeAccountId,
              displayName: assigneeInput.value.trim() || null,
              avatarUrl: null,
            }
            : null,
        });
      }
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
    document.removeEventListener('keydown', onKeydown, true);
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
