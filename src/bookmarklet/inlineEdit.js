import { getTransitions, getPriorities, updateIssue, searchUsers } from './api.js';

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

export function renderInlineEdit(container, options) {
  const { config, session, pin, refresh, onDone, onToast } = options;

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

  statusSelect.disabled = true;
  prioritySelect.disabled = true;

  root.appendChild(field('Status', statusSelect));
  root.appendChild(field('Priority', prioritySelect));
  root.appendChild(field('Assignee', typeahead));

  const statusNote = el('div', 'jiratack-inline-note');
  root.appendChild(statusNote);

  let transitions = [];
  let priorities = [];
  let disposed = false;

  function notify(message) {
    if (onToast) onToast(message);
  }

  async function applyUpdate(fields, optimistic, revert) {
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

    await applyUpdate(
      { priorityId: priorityId || null },
      () => {
        pin.priority = priorityId && selected ? { id: selected.id, name: selected.name } : null;
      },
      () => {
        pin.priority = previous;
      },
    );
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
    if (!users || users.length === 0) {
      hideTypeahead();
      return;
    }
    typeaheadResults.style.display = 'block';
    users.forEach((user) => {
      const item = el('div', 'jiratack-typeahead-item', user.displayName || user.accountId);
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

  assigneeInput.addEventListener('input', () => {
    assigneeAccountId = null;
    if (assigneeDebounce) {
      window.clearTimeout(assigneeDebounce);
      assigneeDebounce = null;
    }

    const query = assigneeInput.value.trim();
    if (query.length === 0 || !pin.projectKey) {
      hideTypeahead();
      return;
    }

    assigneeDebounce = window.setTimeout(async () => {
      assigneeDebounce = null;
      assigneeRequestId += 1;
      const requestId = assigneeRequestId;
      try {
        const result = await searchUsers(config, session, pin.projectKey, query);
        if (requestId !== assigneeRequestId || disposed) return;
        renderTypeahead((result && result.users) || []);
      } catch (e) {
        hideTypeahead();
      }
    }, 300);
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
      container.innerHTML = '';
    },
  };
}
