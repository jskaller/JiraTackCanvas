const SELECTED_CLASS = 'jiratack-ticket-selected';

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function buildIssueUrl(config, session, key) {
  const explicit = (config && config.jiraBaseUrl) || (session && session.jiraBaseUrl);
  if (explicit) {
    return `${String(explicit).replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;
  }
  if (typeof location !== 'undefined' && /\.atlassian\.net$/i.test(location.hostname)) {
    return `${location.origin}/browse/${encodeURIComponent(key)}`;
  }
  return `/browse/${encodeURIComponent(key)}`;
}

function addPerson(container, label, user) {
  const name = user && user.displayName ? user.displayName : '—';
  container.appendChild(make('span', 'jiratack-person', `${label}: ${name}`));
}

export function renderSidebar(container, options) {
  const { canvasName, session, pins, config, onSelect } = options;

  const header = container.querySelector('.jiratack-sidebar-header');
  const list = container.querySelector('.jiratack-ticket-list');
  const form = container.querySelector('.jiratack-new-ticket-form');

  header.innerHTML = '';
  list.innerHTML = '';
  form.innerHTML = '';

  header.appendChild(make('div', 'jiratack-sidebar-title', canvasName || 'JiraTack'));

  const badges = make('div', 'jiratack-badges');
  if (session && session.scope === 'view') {
    badges.appendChild(make('span', 'jiratack-badge jiratack-badge-view', 'View only'));
  }
  if (session && Array.isArray(session.permittedProjects)) {
    badges.appendChild(
      make('span', 'jiratack-badge', `Viewing ${session.permittedProjects.length} projects`),
    );
  }
  if (badges.childNodes.length > 0) header.appendChild(badges);

  const cards = new Map();

  if (!pins || pins.length === 0) {
    list.appendChild(make('div', 'jiratack-empty', 'No pins on this page.'));
  } else {
    pins.forEach((pin) => {
      const card = make('div', 'jiratack-ticket-card');
      card.dataset.key = pin.key;

      card.appendChild(make('div', 'jiratack-ticket-key', pin.key));
      card.appendChild(make('div', 'jiratack-ticket-summary', pin.summary || ''));

      const meta = make('div', 'jiratack-ticket-meta');
      if (pin.status && pin.status.name) {
        meta.appendChild(make('span', 'jiratack-chip jiratack-status', pin.status.name));
      }
      if (pin.priority && pin.priority.name) {
        meta.appendChild(make('span', 'jiratack-chip jiratack-priority', pin.priority.name));
      }
      if (pin.issueType && pin.issueType.name) {
        meta.appendChild(make('span', 'jiratack-chip jiratack-issuetype', pin.issueType.name));
      }
      if (meta.childNodes.length > 0) card.appendChild(meta);

      const people = make('div', 'jiratack-ticket-people');
      addPerson(people, 'Assignee', pin.assignee);
      addPerson(people, 'Reporter', pin.reporter);
      card.appendChild(people);

      card.addEventListener('click', () => {
        select(pin.key);
        if (session && session.scope === 'view') {
          window.open(buildIssueUrl(config, session, pin.key), '_blank', 'noopener');
        }
        if (onSelect) onSelect(pin);
      });

      list.appendChild(card);
      cards.set(pin.key, card);
    });
  }

  function select(key) {
    cards.forEach((card, cardKey) => {
      card.classList.toggle(SELECTED_CLASS, cardKey === key);
    });
  }

  function destroy() {
    cards.clear();
  }

  return { select, destroy };
}
