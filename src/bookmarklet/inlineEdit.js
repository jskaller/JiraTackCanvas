import { getTransitions, getPriorities, updateIssue } from './api.js';

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
  const assigneeInput = el('input', 'jiratack-inline-input');
  assigneeInput.type = 'text';
  assigneeInput.placeholder = 'accountId';

  statusSelect.disabled = true;
  prioritySelect.disabled = true;

  root.appendChild(field('Status', statusSelect));
  root.appendChild(field('Priority', prioritySelect));
  root.appendChild(field('Assignee', assigneeInput));

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

    assigneeInput.value = pin.assignee && pin.assignee.accountId ? pin.assignee.accountId : '';
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

  let assigneeInFlight = false;
  async function commitAssignee() {
    if (assigneeInFlight) return;
    const value = assigneeInput.value.trim();
    const previous = pin.assignee ? { ...pin.assignee } : null;
    const currentAccount = previous && previous.accountId ? previous.accountId : '';
    if (value === currentAccount) return;

    assigneeInFlight = true;
    await applyUpdate(
      { assigneeAccountId: value || null },
      () => {
        pin.assignee = value ? { accountId: value, displayName: value, avatarUrl: null } : null;
      },
      () => {
        pin.assignee = previous;
      },
    );
    assigneeInFlight = false;
  }

  assigneeInput.addEventListener('change', commitAssignee);
  assigneeInput.addEventListener('blur', commitAssignee);

  loadOptions();

  return {
    destroy() {
      disposed = true;
      container.innerHTML = '';
    },
  };
}
