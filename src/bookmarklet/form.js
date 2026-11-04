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
import { createTextPreview } from './textPreview.js';
import { openTextPopover } from './capturePopover.js';
import { supportsTabRecording, recordCurrentTab } from './recording.js';
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
  const {
    config,
    session,
    capture,
    onCancel,
    onCreated,
    defaultProject,
    defaultAssignee,
    defaultIssueTypeId,
    defaultIssueTypeName,
    defaultPriorityId,
    defaultParentKey,
    capturePopoverHost,
  } = options;
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
  let screenshotFailed = Boolean(options.screenshotFailed);
  let submitting = false;
  let destroyed = false;
  const pageUrl = normalizeUrl(stripDeepLinkParams(window.location.href));

  const textSelection = options.textSelection || null;
  const textPreview = options.textPreview || createTextPreview();
  let textChangeState = options.textChange
    ? { original: String(options.textChange.original || ''), suggested: String(options.textChange.suggested || '') }
    : null;
  let textComposer = null;
  let textChangeRow = null;

  container.innerHTML = '';

  const form = el('form', 'jiratack-form');

  function field(labelText, control) {
    // An implicit <label> keeps the field accessible without inventing ids for
    // every control, and still lets the label wrap a typeahead div.
    const wrap = el('label', 'jiratack-field');
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

  function sectionHead(title, hint) {
    const head = el('div', 'jiratack-section-head');
    head.appendChild(el('span', 'jiratack-section-title', title));
    if (hint) head.appendChild(el('span', 'jiratack-section-hint', hint));
    return head;
  }


  const permitted = Array.isArray(session.permittedProjects) ? session.permittedProjects : [];
  const openMode = session.permittedProjects === '*';

  const resolvedDefaultProject = defaultProject || (permitted.length > 0 ? permitted[0] : '');
  const resolvedDefaultIssueTypeId = defaultIssueTypeId || null;
  const resolvedDefaultIssueTypeName = defaultIssueTypeName || null;
  const resolvedDefaultPriorityId = defaultPriorityId || null;

  let projectSelect = null;
  let projectInput = null;

  if (!openMode && permitted.length > 0) {
    projectSelect = el('select', 'jiratack-input jiratack-select');
    projectSelect.id = 'jiratack-project';
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
    projectInput.id = 'jiratack-project';
  }

  function getProjectKey() {
    if (projectSelect) return projectSelect.value.trim().toUpperCase();
    return projectInput ? projectInput.value.trim().toUpperCase() : '';
  }

  const issueTypeSelect = el('select', 'jiratack-input jiratack-select');
  issueTypeSelect.id = 'jiratack-issue-type';
  issueTypeSelect.disabled = true;
  const initialTypeOption = el('option', null, 'Select a project first');
  initialTypeOption.value = '';
  issueTypeSelect.appendChild(initialTypeOption);

  const summaryInput = textInput('Pin Summary', options.initialSummary || '');
  summaryInput.id = 'jiratack-summary';
  summaryInput.className = 'jiratack-input jiratack-input-primary';
  summaryInput.maxLength = 215;
  summaryInput.setAttribute('aria-required', 'true');

  const descriptionInput = el('textarea', 'jiratack-textarea jiratack-textarea-primary');
  descriptionInput.id = 'jiratack-description';
  descriptionInput.rows = 5;
  descriptionInput.placeholder = 'Detailed Description';
  descriptionInput.value = options.initialDescription || '';

  const summaryCounter = el('span', 'jiratack-counter', '0/215');
  const summaryHead = el('div', 'jiratack-field-head');
  const summaryLabel = el('label', 'jiratack-field-label', 'Summary');
  summaryLabel.htmlFor = 'jiratack-summary';
  summaryHead.appendChild(summaryLabel);
  const requiredMark = el('span', 'jiratack-required', '*');
  requiredMark.setAttribute('aria-hidden', 'true');
  summaryHead.appendChild(requiredMark);
  summaryHead.appendChild(summaryCounter);

  const summaryError = el('div', 'jiratack-field-error');
  summaryError.style.display = 'none';

  const summaryField = el('div', 'jiratack-field jiratack-field-primary');
  summaryField.appendChild(summaryHead);
  summaryField.appendChild(summaryInput);
  summaryField.appendChild(summaryError);

  const descriptionHead = el('div', 'jiratack-field-head');
  const descriptionLabel = el('label', 'jiratack-field-label', 'Description');
  descriptionLabel.htmlFor = 'jiratack-description';
  descriptionHead.appendChild(descriptionLabel);
  descriptionHead.appendChild(el('span', 'jiratack-optional', 'Optional'));

  const descriptionField = el('div', 'jiratack-field jiratack-field-primary');
  descriptionField.appendChild(descriptionHead);
  descriptionField.appendChild(descriptionInput);

  const assigneeWrap = el('div', 'jiratack-field jiratack-field-assignee');
  if (isGuest) {
    assigneeWrap.appendChild(el('span', 'jiratack-field-label', 'Licensed user'));
  }
  const typeahead = el('div', 'jiratack-typeahead');
  const assigneeInput = textInput('Search by name', '');
  assigneeInput.id = 'jiratack-assignee';
  assigneeInput.setAttribute('aria-label', isGuest ? 'Assign to a licensed user' : 'Assignee');
  const typeaheadResults = el('div', 'jiratack-typeahead-results');
  typeaheadResults.style.display = 'none';
  typeahead.appendChild(assigneeInput);
  typeahead.appendChild(typeaheadResults);
  assigneeWrap.appendChild(typeahead);

  // The reporter is always the authenticated user; a disabled input took a full
  // row for information the reviewer cannot change.
  const reporterLine = el('div', 'jiratack-form-meta');
  reporterLine.textContent = `Reporting as ${session.displayName || 'the current user'}`;
  reporterLine.title = 'The reporter is the authenticated Jira user.';

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

  function buildTextChangeRow(selection) {
    if (!textChangeState) return null;
    const originalText = String(textChangeState.original || '').trim();
    if (!originalText) return null;

    const panel = el('div', 'jiratack-textchange');

    const head = el('div', 'jiratack-textchange-head');
    head.appendChild(el('span', 'jiratack-textchange-title', 'Text change'));

    const toggle = el('button', 'jiratack-switch jiratack-textchange-toggle');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', 'false');
    toggle.setAttribute('aria-label', 'View suggested text on page');
    toggle.appendChild(el('span', 'jiratack-textchange-toggle-label', 'View on page'));
    const switchTrack = el('span', 'jiratack-switch-track');
    switchTrack.appendChild(el('span', 'jiratack-switch-knob'));
    toggle.appendChild(switchTrack);
    head.appendChild(toggle);

    const editButton = el('button', 'jiratack-textchange-edit', 'Edit');
    editButton.type = 'button';
    head.appendChild(editButton);
    panel.appendChild(head);

    const pair = el('div', 'jiratack-textchange-pair');
    const original = el('span', 'jiratack-textchange-original', originalText);
    original.title = originalText;
    pair.appendChild(original);
    pair.appendChild(el('span', 'jiratack-textchange-arrow', ' \u2192 '));
    const suggested = el('span', 'jiratack-textchange-suggested', textChangeState.suggested || '');
    suggested.title = textChangeState.suggested || '';
    pair.appendChild(suggested);
    panel.appendChild(pair);

    const hint = el('div', 'jiratack-textchange-hint', '');
    panel.appendChild(hint);

    function setPreviewState(on) {
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      toggle.classList.toggle('jiratack-switch-on', on);
    }

    function hidePreview() {
      textPreview.hide();
      setPreviewState(false);
      hint.textContent = '';
    }

    function showPreview() {
      const value = String(textChangeState.suggested || '').trim();
      if (!value) {
        setPreviewState(false);
        hint.textContent = 'Write the replacement first.';
        return;
      }
      const mode = textPreview.show({
        text: textChangeState.original,
        range: selection ? selection.range : null,
        anchor: selection ? selection.anchor : null,
        replacement: value,
      });
      if (!mode) {
        setPreviewState(false);
        hint.textContent = 'Select the text again to preview it.';
        return;
      }
      setPreviewState(true);
      hint.textContent = mode === 'inline'
        ? ''
        : 'Previewing with a marker \u2014 this selection spans elements.';
    }

    toggle.addEventListener('click', () => {
      // A re-render can remove the preview while the switch still looks on.
      if (textPreview.isVisible() && !textPreview.isAttached()) {
        textPreview.hide();
        setPreviewState(false);
      }
      if (toggle.getAttribute('aria-checked') === 'true') hidePreview();
      else showPreview();
    });

    editButton.addEventListener('click', () => {
      if (!capturePopoverHost || textComposer) return;
      if (toggle.getAttribute('aria-checked') === 'true') hidePreview();
      const rect = editButton.getBoundingClientRect();
      textComposer = openTextPopover({
        host: capturePopoverHost,
        anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        selection: {
          text: textChangeState.original,
          range: selection ? selection.range : null,
          anchor: selection ? selection.anchor : null,
        },
        initialReplacement: textChangeState.suggested,
        preview: textPreview,
        submitLabel: 'Save',
        onAdd: ({ replacement }) => {
          textComposer = null;
          textChangeState = { original: textChangeState.original, suggested: replacement };
          suggested.textContent = replacement;
          suggested.title = replacement;
          hint.textContent = '';
        },
        onCancel: () => {
          textComposer = null;
        },
      });
    });

    return {
      element: panel,
      hint,
      destroy() {
        hidePreview();
        if (textComposer) {
          try {
            textComposer.destroy();
          } catch (e) {
            // ignore
          }
          textComposer = null;
        }
      },
    };
  }

  // The reviewer's key decision comes first: who is this for. Project and type
  // follow, then the content the popover captured.
  const assignSection = el('section', 'jiratack-form-section jiratack-assignee-card');
  assignSection.appendChild(sectionHead('Assigned to', 'Who should fix this?'));
  assignSection.appendChild(assigneeWrap);
  if (!isGuest) assignSection.appendChild(reporterLine);
  form.appendChild(assignSection);

  const ticketSection = el('section', 'jiratack-form-section');
  ticketSection.appendChild(sectionHead('Ticket', 'Where it goes'));
  const metaGrid = el('div', 'jiratack-form-grid');
  metaGrid.appendChild(field('Project', projectSelect || projectInput));
  metaGrid.appendChild(field('Issue type', issueTypeSelect));
  ticketSection.appendChild(metaGrid);
  ticketSection.appendChild(summaryField);
  form.appendChild(ticketSection);

  if (textChangeState) {
    const autoSummary = `Text change: ${String(textChangeState.original || '').slice(0, 60)}`;
    if (!summaryInput.value) {
      summaryInput.value = autoSummary;
      updateSummaryCounter();
    }
    textChangeRow = buildTextChangeRow(textSelection);
    if (textChangeRow) form.appendChild(textChangeRow.element);
  }

  const descriptionSection = el('section', 'jiratack-form-section');
  descriptionSection.appendChild(descriptionField);
  form.appendChild(descriptionSection);

  const evidenceSection = el('section', 'jiratack-form-section');
  evidenceSection.appendChild(sectionHead('Evidence', 'Screenshot is automatic'));
  form.appendChild(evidenceSection);

  const additional = el('details', 'jiratack-additional');
  additional.appendChild(el('summary', 'jiratack-additional-summary', 'Additional fields'));

  const prioritySelect = el('select', 'jiratack-input jiratack-select');
  const noPriority = el('option', null, 'No priority');
  noPriority.value = '';
  prioritySelect.appendChild(noPriority);
  additional.appendChild(field('Priority', prioritySelect));

  const parentInput = textInput('e.g. MM-123', defaultParentKey || '');
  parentInput.id = 'jiratack-parent';
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

  const preview = el('div', 'jiratack-screenshot');

  function renderPreview() {
    preview.innerHTML = '';
    if (!screenshotDataUrl) {
      preview.style.display = 'none';
      return;
    }
    preview.style.display = 'flex';
    const img = el('img', 'jiratack-screenshot-preview');
    img.src = screenshotDataUrl;
    img.alt = 'Pin screenshot';
    const meta = el('div', 'jiratack-screenshot-meta');
    meta.appendChild(el('span', 'jiratack-screenshot-label', 'Pin screenshot'));
    const remove = el('button', 'jiratack-screenshot-remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      screenshotDataUrl = null;
      screenshotFailed = false;
      if (screenshotWarning) screenshotWarning.style.display = 'none';
      renderPreview();
    });
    meta.appendChild(remove);
    preview.appendChild(img);
    preview.appendChild(meta);
  }


  renderPreview();

  // Attach/record are peers; everything captured appears below them.
  const attachRow = el('div', 'jiratack-attach-row');
  const attachmentInput = el('input', 'jiratack-attachment-input');
  attachmentInput.type = 'file';
  attachmentInput.multiple = true;
  const attachButton = el('button', 'jiratack-button jiratack-attach-button', 'Attach files');
  attachButton.type = 'button';
  attachButton.addEventListener('click', () => attachmentInput.click());
  const videoButton = el('button', 'jiratack-button jiratack-record-button', 'Record screen');
  videoButton.type = 'button';
  attachRow.appendChild(attachButton);
  attachRow.appendChild(videoButton);
  attachRow.appendChild(attachmentInput);

  const evidenceList = el('div', 'jiratack-evidence-list');
  evidenceList.appendChild(preview);

  const attachmentList = el('div', 'jiratack-attachment-list');
  evidenceList.appendChild(attachmentList);

  const attachmentNote = el('div', 'jiratack-form-hint', '');
  evidenceList.appendChild(attachmentNote);

  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderAttachmentList() {
    attachmentList.innerHTML = '';
    Array.from(attachmentInput.files || []).forEach((file) => {
      const item = el('div', 'jiratack-attachment-item');
      const name = el('span', 'jiratack-attachment-name', file.name);
      name.title = file.name;
      item.appendChild(name);
      item.appendChild(el('span', 'jiratack-attachment-size', formatFileSize(file.size)));
      attachmentList.appendChild(item);
    });
  }

  attachmentInput.addEventListener('change', renderAttachmentList);

  // Screen recording (plan 6.5). WebM because Chrome and Firefox both produce
  // it; MP4 would fork the pipeline and Jira's previewer is not the only
  // consumer — our issue panel plays it from attachment content.
  let videoBlob = null;
  let videoDataUrl = null;
  let recording = null;
  let pickerStopTimer = null;
  const videoStatus = el('div', 'jiratack-form-hint', '');
  const videoPreview = el('video', 'jiratack-video-preview');
  videoPreview.controls = true;
  videoPreview.style.display = 'none';
  videoPreview.style.maxWidth = '100%';
  evidenceList.appendChild(videoStatus);
  evidenceList.appendChild(videoPreview);

  function setRecordedDataUrl(dataUrl) {
    videoDataUrl = dataUrl;
    videoBlob = null;
    videoPreview.src = dataUrl;
    videoPreview.style.display = 'block';
    const bytes = Math.round((dataUrl.length * 3) / 4);
    videoStatus.textContent = `Recorded ${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function setRecordedBlob(blob) {
    videoBlob = blob;
    videoDataUrl = null;
    videoPreview.src = URL.createObjectURL(blob);
    videoPreview.style.display = 'block';
    videoStatus.textContent = `Recorded ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
  }

  function setRecordButtonIdle() {
    videoButton.disabled = false;
    videoButton.textContent = 'Record screen';
    videoButton.classList.remove('jiratack-recording');
  }

  function setRecordButtonRecording() {
    videoButton.disabled = false;
    videoButton.textContent = 'Stop recording';
    videoButton.classList.add('jiratack-recording');
  }

  function startTabRecording() {
    videoButton.disabled = true;
    videoStatus.textContent = 'Starting recording…';
    let started = false;

    recording = recordCurrentTab({
      onStatus(state) {
        if (state === 'recording') {
          started = true;
          setRecordButtonRecording();
          videoStatus.textContent = 'Recording the current tab. Stops after 60 seconds.';
        } else if (state === 'stopping') {
          videoButton.disabled = true;
          videoStatus.textContent = 'Finishing recording…';
        }
      },
      onResult(dataUrl) {
        recording = null;
        if (destroyed) return;
        setRecordButtonIdle();
        if (!dataUrl) {
          videoStatus.textContent = '';
          showError('Recording could not be saved.');
          return;
        }
        setRecordedDataUrl(dataUrl);
      },
      onError(message) {
        recording = null;
        if (destroyed) return;
        setRecordButtonIdle();
        videoStatus.textContent = '';
        if (started) {
          showError(message || 'Recording failed.');
          return;
        }
        // chrome.tabCapture can be unavailable on a restricted tab. The display
        // picker is the honest fallback, even though it cannot skip its prompt.
        startPickerRecording();
      },
    });

    if (!recording) startPickerRecording();
  }

  async function startPickerRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      showError('Screen recording is not available in this browser.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, displaySurface: 'browser' },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include',
      });
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
      if (pickerStopTimer) {
        window.clearTimeout(pickerStopTimer);
        pickerStopTimer = null;
      }
      recording = null;
      if (destroyed) return;
      setRecordButtonIdle();
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (!blob.size) {
        showError('Recording could not be saved.');
        return;
      }
      setRecordedBlob(blob);
    });

    const stop = () => {
      if (recorder.state === 'recording') recorder.stop();
    };
    recording = {
      stop,
      destroy() {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch (e) {
          // ignore
        }
        stream.getTracks().forEach((track) => track.stop());
      },
    };
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', stop));
    recorder.start();
    setRecordButtonRecording();
    videoStatus.textContent = 'Recording… stops after 60 seconds.';
    pickerStopTimer = window.setTimeout(stop, 60000);
  }

  videoButton.addEventListener('click', () => {
    if (recording) {
      recording.stop();
      videoButton.disabled = true;
      videoStatus.textContent = 'Finishing recording…';
      return;
    }
    if (supportsTabRecording(config)) startTabRecording();
    else startPickerRecording();
  });

  evidenceSection.appendChild(attachRow);
  evidenceSection.appendChild(evidenceList);

  const screenshotWarning = el(
    'div',
    'jiratack-form-warning',
    'Screenshot could not be captured due to site security. Ticket will be created without an image.',
  );
  screenshotWarning.style.display = screenshotFailed ? 'block' : 'none';
  evidenceSection.appendChild(screenshotWarning);

  form.appendChild(additional);

  let attachmentLimit = 0;
  getAttachmentLimits(config, session).then((limits) => {
    if (!limits || !limits.uploadLimit) return;
    attachmentLimit = limits.uploadLimit;
    const mb = Math.round(limits.uploadLimit / (1024 * 1024));
    attachmentNote.textContent = `Up to ${mb} MB per file, as set by Jira.`;
  }).catch(() => {
    // Limits are advisory; the server still enforces Jira's rule.
  });

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
  actions.appendChild(el('span', 'jiratack-form-shortcut', '⌘/Ctrl + Enter'));
  form.appendChild(actions);

  container.appendChild(form);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function showSummaryError(message) {
    summaryError.textContent = message;
    summaryError.style.display = 'block';
    summaryInput.setAttribute('aria-invalid', 'true');
  }

  function hideSummaryError() {
    summaryError.textContent = '';
    summaryError.style.display = 'none';
    summaryInput.removeAttribute('aria-invalid');
  }

  function updateSummaryCounter() {
    summaryCounter.textContent = `${summaryInput.value.length}/215`;
    if (summaryInput.value.trim().length >= 3) hideSummaryError();
  }

  summaryInput.addEventListener('input', updateSummaryCounter);
  updateSummaryCounter();

  function cancel() {
    destroy();
    if (onCancel) onCancel();
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    // The composer is a child surface; Escape closes it, not the whole draft.
    if (textComposer) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  document.addEventListener('keydown', onKeydown, true);

  function clearError() {
    errorBox.textContent = '';
    errorBox.style.display = 'none';
    hideSummaryError();
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
        // Never leave the form unsaveable: if the last ticket had a type, keep
        // it selectable even when Jira returns an empty list for this project.
        if (resolvedDefaultIssueTypeId) {
          const keep = el('option', null, resolvedDefaultIssueTypeName || 'Last used issue type');
          keep.value = String(resolvedDefaultIssueTypeId);
          issueTypeSelect.appendChild(keep);
          issueTypeSelect.value = String(resolvedDefaultIssueTypeId);
          issueTypeSelect.disabled = false;
          return;
        }
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
      } else if (resolvedDefaultIssueTypeId) {
        // The previous default is not in this project's creatable list (a
        // subtask type, a moved project, a filtered screen). Keep it visible so
        // the reviewer can still submit the ticket they were writing.
        const keep = el('option', null, resolvedDefaultIssueTypeName || 'Last used issue type');
        keep.value = String(resolvedDefaultIssueTypeId);
        issueTypeSelect.appendChild(keep);
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
    if (textChangeRow) textChangeRow.hint.textContent = '';

    // The summary is prefilled when a text change is present, so the reviewer
    // sees what will be sent. Do not silently re-derive it if they cleared it.
    const editOriginal = textChangeState ? String(textChangeState.original || '').trim() : '';
    const editReplacement = textChangeState ? String(textChangeState.suggested || '').trim() : '';

    const summary = summaryInput.value.trim();
    const projectKey = getProjectKey();
    const issueTypeId = issueTypeSelect.value.trim();
    const parentKey = parentInput.value.trim();

    if (!projectKey) {
      showError('Select a project.');
      if (projectSelect) projectSelect.focus();
      else if (projectInput) projectInput.focus();
      return;
    }
    if (summary.length < 3) {
      showSummaryError('Summary must be at least 3 characters.');
      summaryInput.focus();
      return;
    }
    if (textChangeRow && editOriginal && !editReplacement) {
      textChangeRow.hint.textContent = 'Write the replacement, or remove the text change.';
      return;
    }
    if (!issueTypeId) {
      showError('Select an issue type.');
      if (!issueTypeSelect.disabled) issueTypeSelect.focus();
      return;
    }
    if (parentKey && !PARENT_KEY_RE.test(parentKey)) {
      additional.open = true;
      showError('Parent key must look like MM-123.');
      parentInput.focus();
      return;
    }

    if (isGuest && !assigneeAccountId) {
      showError('Select a licensed user to assign this ticket to.');
      assigneeInput.focus();
      return;
    }

    const consoleLog = consoleCheckbox && consoleCheckbox.checked
      ? formatConsoleLog(consoleSnapshot)
      : null;

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';

    try {
      let descriptionText = descriptionInput.value;
      if (editOriginal && editReplacement) {
        descriptionText = `Text change\nOriginal: ${editOriginal}\nSuggested: ${editReplacement}\n\n${descriptionText}`;
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
      console.log(`[JiraTack] attachments selected: ${files.length}`);
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
        console.log(`[JiraTack] attachment upload: ${file.name} ${file.type || '(no type)'} ${file.size}B -> ${uploadId || 'NO ID'}`);
        if (uploadId) attachmentIds.push(uploadId);
      }

      if (videoDataUrl || videoBlob) {
        const recordingDataUrl = videoDataUrl || await readFileAsDataUrl(videoBlob);
        const bytes = Math.round((recordingDataUrl.length * 3) / 4);
        if (attachmentLimit && bytes > attachmentLimit) {
          const mb = Math.round(attachmentLimit / (1024 * 1024));
          throw new Error(`The recording is larger than Jira allows (${mb} MB).`);
        }
        const videoUploadId = await uploadAttachment(config, session, {
          dataUrl: recordingDataUrl,
          filename: `jiratack-recording-${Date.now()}.webm`,
          mimeType: 'video/webm',
        });
        if (videoUploadId) attachmentIds.push(videoUploadId);
      }

      console.log(`[JiraTack] sending ${attachmentIds.length} attachment id(s)`);
      const textChange = editOriginal && editReplacement
        ? {
          original: editOriginal,
          suggested: editReplacement,
          anchor: options.textSelection && options.textSelection.anchor
            ? options.textSelection.anchor
            : undefined,
        }
        : null;
      // The first ticket on a canvas also supplies its card preview (D43).
      let canvasThumbnail = null;
      let canvasThumbnailNote = null;
      if (options.needsCanvasThumbnail && typeof options.captureCanvasThumbnail === 'function') {
        try {
          canvasThumbnail = await options.captureCanvasThumbnail();
        } catch (e) {
          canvasThumbnail = null;
          canvasThumbnailNote = `Page capture failed: ${e && e.message ? e.message : String(e)}`;
        }
        // The page capture can be refused (CSP, a capture race, a page that
        // html2canvas cannot render). The ticket's own screenshot is still a
        // real image of the page, so use it rather than showing no preview.
        if (!canvasThumbnail && screenshotDataUrl) {
          canvasThumbnail = await thumbnailFromDataUrl(screenshotDataUrl);
          if (!canvasThumbnail) canvasThumbnailNote = 'The screenshot could not be scaled for the card.';
        }
        if (!canvasThumbnail && !canvasThumbnailNote) {
          canvasThumbnailNote = screenshotDataUrl
            ? 'No page image was produced.'
            : 'This page produced no screenshot.';
        }
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
        canvasThumbnail,
        canvasThumbnailNote,
        attachmentUploadIds: attachmentIds,
        consoleLog,
        issueTypeId,
        projectKey,
        priorityId: prioritySelect.value || null,
        assigneeAccountId: assigneeAccountId || null,
        parentKey: parentKey || null,
        textChange,
      });

      if (result && result.warning) {
        console.warn(`[JiraTack] Ticket ${result.key} created with warning: ${result.warning}`);
      }

      destroy();
      if (onCreated) {
        onCreated({
          result,
          capture,
          summary,
          projectKey,
          issueTypeId,
          priorityId: prioritySelect.value || null,
          textChange,
          parentKey: parentKey || null,
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
  form.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      handleSubmit(event);
    }
  });

  // Assignee is the key field, so it gets focus first. If no project is
  // resolved the ticket cannot be created, and that control is the honest
  // target instead.
  const initialProjectKey = getProjectKey();
  if (!initialProjectKey) {
    if (projectSelect) projectSelect.focus();
    else if (projectInput) projectInput.focus();
  } else {
    try {
      assigneeInput.focus({ preventScroll: false });
      if (assigneeInput.value) assigneeInput.select();
    } catch (e) {
      assigneeInput.focus();
    }
  }

  function destroy() {
    destroyed = true;
    textPreview.hide();
    if (textChangeRow) textChangeRow.destroy();
    if (recording) {
      try {
        recording.destroy();
      } catch (e) {
        // ignore
      }
      recording = null;
    }
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
