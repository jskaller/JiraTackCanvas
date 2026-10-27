import { getTransitions, getPriorities, updateIssue, searchUsers } from './api.js';

const SUMMARY_PREFIX = '[JiraTack]';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function field(labelText, control) {
  const wrap = el('div', 'jiratack-inline-field');
  wrap.appendChild(el('span', 'jiratack-inline-label', labelText));
  wrap.appendChild(control);
  return wrap;
}

function stripSummary(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith(SUMMARY_PREFIX) ? text.slice(SUMMARY_PREFIX.length).trim() : text;
}

function withSummaryPrefix(value) {
  return value.startsWith(SUMMARY_PREFIX) ? value : `${SUMMARY_PREFIX} ${value}`;
}

function userAvatar(user, name) {
  if (user && user.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'jiratack-typeahead-avatar';
    img.src = user.avatarUrl;
    img.alt = '';
    return img;
  }
  const initial = name && name.trim().length > 0 ? name.trim().charAt(0).toUpperCase() : '?';
  return el('span', 'jiratack-typeahead-avatar jiratack-avatar-empty', initial);
}

export function renderInlineEdit(container, options) {
  const { config, session, pin, refresh, onDone, onToast, onEditStart } = options;

  container.innerHTML = '';
  const root = el('div', 'jiratack-inline-edit');
  container.appendChild(root);

  const statusSelect = el('select', 'jiratack-inline-select');
  const prioritySelect = el('select', 'jiratack-inline-select');

  const typeahead = el('div', 'jiratack-typeahead');
  const assigneeInput = el('input', 'jiratack-inline-input');
  assigneeInput.type = 'text';
  assigneeInput.placeholder = 'Search by name';
  const typeaheadResults = el('div', 'jiratack-typeahead-results');
  typeaheadResults.style.display = 'none';
  typeahead.appendChild(assigneeInput);
  typeahead.appendChild(typeaheadResults);

  const summaryInput = el('input', 'jiratack-inline-input');
  summaryInput.type = 'text';
  summaryInput.maxLength = 215;
  summaryInput.placeholder = 'Short summary';

  const descriptionInput = el('textarea', 'jiratack-inline-input jiratack-inline-textarea');
  descriptionInput.rows = 4;
  descriptionInput.disabled = true;
  descriptionInput.placeholder = 'Loading description…';

  const descriptionActions = el('div', 'jiratack-inline-actions');
  const descriptionSave = el('button', 'jiratack-inline-button', 'Save description');
  descriptionSave.type = 'button';
  descriptionSave.disabled = true;
  descriptionActions.appendChild(descriptionSave);

  const descriptionField = field('Description', descriptionInput);
  const descriptionNote = el('div', 'jiratack-inline-note');
  descriptionField.appendChild(descriptionActions);
  descriptionField.appendChild(descriptionNote);

  statusSelect.disabled = true;
  prioritySelect.disabled = true;

  root.appendChild(field('Status', statusSelect));
  root.appendChild(field('Priority', prioritySelect));
  root.appendChild(field('Assignee', typeahead));
  root.appendChild(field('Summary', summaryInput));
  root.appendChild(descriptionField);

  const statusNote = el('div', 'jiratack-inline-note');
  root.appendChild(statusNote);
  const errorNote = el('div', 'jiratack-inline-note jiratack-inline-error');
  root.appendChild(errorNote);

  let transitions = [];
  let priorities = [];
  let disposed = false;

  let descriptionInitial = '';
  let descriptionLoaded = false;
  let summaryInitial = stripSummary(pin.summary);
  let summarySaving = false;
  summaryInput.value = summaryInitial;

  function markEdited() {
    if (onEditStart) onEditStart(pin);
  }

  function notify(message) {
    errorNote.textContent = message || '';
    if (onToast) onToast(message);
  }

  function showErrorNote(message) {
    errorNote.textContent = message || '';
  }

  function clearErrorNote() {
    errorNote.textContent = '';
  }

  function updateDescriptionButton() {
    descriptionSave.disabled = !descriptionLoaded
      || descriptionInput.value === descriptionInitial;
  }

  async function applyUpdate(fields, optimistic, revert) {
    markEdited();
    clearErrorNote();
    optimistic();
    if (refresh) refresh();

    try {
      await updateIssue(config, session, pin.key, fields);
      return true;
    } catch (e) {
      revert();
      if (refresh) refresh();
      const code = e && e.code ? `${e.code}: ` : '';
      notify(`${code}${(e && e.message) || 'Update failed.'}`);
      return false;
    }
  }

  async function loadOptions() {
    try {
      const [transitionsResult, prioritiesResult] = await Promise.all([
        getTransitions(config, session, pin.key),
        getPriorities(config, session),
      ]);
      if (disposed) return;
      transitions = (transitionsResult && transitionsResult.transitions) || [];
      priorities = (prioritiesResult && prioritiesResult.priorities) || [];

      const descriptionText = transitionsResult ? transitionsResult.descriptionText : null;
      if (typeof descriptionText === 'string') {
        descriptionInitial = descriptionText;
        descriptionInput.value = descriptionText;
        descriptionInput.disabled = false;
        descriptionInput.placeholder = 'Describe the issue…';
        descriptionLoaded = true;
        updateDescriptionButton();
      } else {
        descriptionInput.placeholder = 'Description editing is unavailable.';
        descriptionNote.textContent = 'This description is missing the JiraTack pin marker. Edit it in Jira instead.';
      }
    } catch (e) {
      if (disposed) return;
      statusNote.textContent = 'Could not load editing options.';
      return;
    }

    statusSelect.innerHTML = '';
    const currentStatus = el('option', null, pin.status && pin.status.name ? pin.status.name : 'Current status');
    currentStatus.value = '';
    statusSelect.appendChild(currentStatus);
    transitions.forEach((transition) => {
      const option = el('option', null, transition.name);
      option.value = transition.id;
      statusSelect.appendChild(option);
    });
    statusSelect.disabled = transitions.length === 0;
    if (transitions.length === 0) statusNote.textContent = 'No transitions available.';

    prioritySelect.innerHTML = '';
    const noPriority = el('option', null, 'No priority');
    noPriority.value = '';
    prioritySelect.appendChild(noPriority);
    priorities.forEach((priority) => {
      const option = el('option', null, priority.name);
      option.value = priority.id;
      prioritySelect.appendChild(option);
    });
    if (pin.priority && pin.priority.id) {
      prioritySelect.value = String(pin.priority.id);
    } else {
      prioritySelect.value = '';
    }
    prioritySelect.disabled = priorities.length === 0;

    assigneeInput.value = pin.assignee
      ? (pin.assignee.displayName || pin.assignee.accountId || '')
      : '';
  }

  statusSelect.addEventListener('change', async () => {
    const transitionId = statusSelect.value;
    if (!transitionId) return;

    const transition = transitions.find((item) => item.id === transitionId);
    const previous = pin.status ? { ...pin.status } : null;
    const next = transition
      ? {
          name: transition.to.name,
          category: transition.to.statusCategory.key,
          colorName: (previous && previous.colorName) || '',
        }
      : previous;

    const ok = await applyUpdate(
      { statusId: transitionId },
      () => {
        pin.status = next;
      },
      () => {
        pin.status = previous;
      },
    );

    if (ok && transition && transition.to.statusCategory.key === 'done' && onDone) {
      onDone(pin);
    }
    if (!ok) {
      statusSelect.value = '';
    }
  });

  prioritySelect.addEventListener('change', async () => {
    const priorityId = prioritySelect.value;
    const previous = pin.priority ? { ...pin.priority } : null;
    const selected = priorities.find((item) => item.id === priorityId);

    const ok = await applyUpdate(
      { priorityId: priorityId || null },
      () => {
        pin.priority = priorityId && selected ? { id: selected.id, name: selected.name } : null;
      },
      () => {
        pin.priority = previous;
      },
    );

    if (!ok) prioritySelect.value = previous && previous.id ? String(previous.id) : '';
  });

  async function saveSummary() {
    if (summarySaving || disposed) return;
    const raw = summaryInput.value.trim();
    if (raw === summaryInitial) {
      summaryInput.value = summaryInitial;
      return;
    }
    if (raw.length < 3) {
      notify('Summary must be at least 3 characters.');
      summaryInput.value = summaryInitial;
      return;
    }

    summarySaving = true;
    const previous = pin.summary;
    const ok = await applyUpdate(
      { summary: raw },
      () => {
        pin.summary = withSummaryPrefix(raw);
      },
      () => {
        pin.summary = previous;
      },
    );
    summarySaving = false;

    if (ok) {
      summaryInitial = raw;
      summaryInput.value = raw;
    } else {
      summaryInput.value = summaryInitial;
    }
  }

  summaryInput.addEventListener('input', markEdited);
  summaryInput.addEventListener('blur', saveSummary);
  summaryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      summaryInput.blur();
    }
  });

  descriptionInput.addEventListener('input', () => {
    markEdited();
    updateDescriptionButton();
  });

  descriptionSave.addEventListener('click', async () => {
    if (!descriptionLoaded || disposed) return;
    const next = descriptionInput.value;
    if (next === descriptionInitial) return;

    descriptionSave.disabled = true;
    const ok = await applyUpdate(
      { descriptionText: next },
      () => {
        pin.descriptionText = next;
      },
      () => {
        pin.descriptionText = descriptionInitial;
      },
    );

    if (ok) {
      descriptionInitial = next;
    }
    updateDescriptionButton();
  });

  let assigneeAccountId = pin.assignee && pin.assignee.accountId ? pin.assignee.accountId : null;
  let assigneeDebounce = null;
  let assigneeRequestId = 0;

  function hideTypeahead() {
    typeaheadResults.innerHTML = '';
    typeaheadResults.style.display = 'none';
  }

  function renderTypeahead(users) {
    typeaheadResults.innerHTML = '';
    if (pin.assignee) {
      const unassign = el('div', 'jiratack-typeahead-item jiratack-typeahead-unassign', 'Unassign');
      unassign.addEventListener('mousedown', async (event) => {
        event.preventDefault();
        const previous = pin.assignee ? { ...pin.assignee } : null;
        assigneeAccountId = null;
        assigneeInput.value = '';
        hideTypeahead();

        await applyUpdate(
          { assigneeAccountId: null },
          () => {
            pin.assignee = null;
          },
          () => {
            pin.assignee = previous;
            assigneeAccountId = previous && previous.accountId ? previous.accountId : null;
            assigneeInput.value = previous ? (previous.displayName || previous.accountId || '') : '';
          },
        );
      });
      typeaheadResults.appendChild(unassign);
    }

    if (!users || users.length === 0) {
      if (pin.assignee) typeaheadResults.style.display = 'block';
      else hideTypeahead();
      return;
    }
    typeaheadResults.style.display = 'block';
    users.forEach((user) => {
      const name = user.displayName || user.accountId;
      const item = el('div', 'jiratack-typeahead-item');
      item.appendChild(userAvatar(user, name));
      item.appendChild(el('span', 'jiratack-typeahead-name', name));
      item.addEventListener('mousedown', async (event) => {
        event.preventDefault();
        const previous = pin.assignee ? { ...pin.assignee } : null;
        const next = {
          accountId: user.accountId,
          displayName: user.displayName || user.accountId,
          avatarUrl: user.avatarUrl || null,
        };
        assigneeAccountId = user.accountId;
        assigneeInput.value = next.displayName;
        hideTypeahead();

        await applyUpdate(
          { assigneeAccountId: user.accountId },
          () => {
            pin.assignee = next;
          },
          () => {
            pin.assignee = previous;
            assigneeAccountId = previous && previous.accountId ? previous.accountId : null;
            assigneeInput.value = previous ? (previous.displayName || previous.accountId || '') : '';
          },
        );
      });
      typeaheadResults.appendChild(item);
    });
  }

  async function searchAssignees(query) {
    if (!pin.projectKey) {
      hideTypeahead();
      return;
    }

    assigneeRequestId += 1;
    const requestId = assigneeRequestId;
    try {
      const result = await searchUsers(config, session, pin.projectKey, query);
      if (requestId !== assigneeRequestId || disposed) return;
      clearErrorNote();
      renderTypeahead((result && result.users) || []);
    } catch (e) {
      if (requestId !== assigneeRequestId || disposed) return;
      hideTypeahead();
      if (query.length > 0) {
        showErrorNote((e && e.message) || 'Could not search users.');
      }
    }
  }

  assigneeInput.addEventListener('input', () => {
    markEdited();
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

    assigneeDebounce = window.setTimeout(() => {
      assigneeDebounce = null;
      searchAssignees(query);
    }, 300);
  });

  assigneeInput.addEventListener('focus', () => {
    if (typeaheadResults.style.display === 'block') return;
    searchAssignees(assigneeInput.value.trim());
  });

  assigneeInput.addEventListener('blur', () => {
    window.setTimeout(hideTypeahead, 150);
    if (!assigneeAccountId && pin.assignee) {
      assigneeInput.value = pin.assignee.displayName || pin.assignee.accountId || '';
    }
  });

  loadOptions();

  return {
    destroy() {
      disposed = true;
      assigneeRequestId += 1;
      if (assigneeDebounce) {
        window.clearTimeout(assigneeDebounce);
        assigneeDebounce = null;
      }
      container.innerHTML = '';
    },
  };
}
