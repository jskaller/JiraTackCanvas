import { renderInlineEdit } from './inlineEdit.js';

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

function isDone(pin) {
  return Boolean(pin && pin.status && pin.status.category === 'done');
}

export function renderSidebar(container, options) {
  const { canvasName, session, pins, config, onSelect, onToast, onDone } = options;

  const header = container.querySelector('.jiratack-sidebar-header');
  const selectorContainer = container.querySelector('.jiratack-canvas-selector');
  const list = container.querySelector('.jiratack-ticket-list');
  const form = container.querySelector('.jiratack-new-ticket-form');

  header.innerHTML = '';
  if (selectorContainer) selectorContainer.innerHTML = '';
  list.innerHTML = '';
  form.innerHTML = '';

  const isUniversal = Boolean(options.canvasSelector);

  if (isUniversal) {
    const hasSelectedCanvas = Boolean(canvasName && canvasName !== 'JiraTack Launcher');
    const title = make(
      'div',
      'jiratack-sidebar-title',
      hasSelectedCanvas ? canvasName : 'JiraTack Launcher',
    );
    header.appendChild(title);

    if (hasSelectedCanvas) {
      const switchButton = make('button', 'jiratack-switch-canvas', 'Switch Canvas');
      switchButton.type = 'button';
      switchButton.addEventListener('click', () => {
        if (options.canvasSelector && options.canvasSelector.onSwitch) {
          options.canvasSelector.onSwitch();
        }
      });
      header.appendChild(switchButton);
    }

    const badges = make('div', 'jiratack-badges');
    if (session && session.scope === 'view') {
      badges.appendChild(make('span', 'jiratack-badge jiratack-badge-view', 'View only'));
    }
    if (badges.childNodes.length > 0) header.appendChild(badges);

    if (!hasSelectedCanvas) {
      const canvases = (options.canvasSelector && options.canvasSelector.canvases) || [];
      if (canvases.length === 0) {
        const error = make('div', 'jiratack-canvas-error', `No canvases found. API returned: ${canvases.length}`);
        selectorContainer.appendChild(error);
      } else {
        const canvasList = make('div', 'jiratack-canvas-list');
        canvases.forEach((canvas) => {
          const button = make('button', 'jiratack-canvas-button', canvas.canvasName);
          button.type = 'button';
          button.addEventListener('click', () => {
            if (options.canvasSelector.onChange) options.canvasSelector.onChange(canvas.canvasName);
          });
          canvasList.appendChild(button);
        });
        selectorContainer.appendChild(canvasList);
      }

      const createButton = make('button', 'jiratack-create-canvas', '+ Create new canvas…');
      createButton.type = 'button';
      createButton.addEventListener('click', () => {
        if (options.canvasSelector.onCreate) options.canvasSelector.onCreate();
      });
      selectorContainer.appendChild(createButton);

      if (options.emptyMessage) {
        list.appendChild(make('div', 'jiratack-empty', options.emptyMessage));
      } else {
        list.appendChild(make('div', 'jiratack-empty', 'Select a canvas to start.'));
      }
    } else {
      selectorContainer.innerHTML = '';
    }
  } else {
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
  }

  const cards = new Map();
  const controllers = [];

  if (!isUniversal || canvasName) {
    if (!pins || pins.length === 0) {
      list.appendChild(make('div', 'jiratack-empty', options.emptyMessage || 'No pins on this page.'));
    } else {
      pins.forEach((pin) => {
        const card = make('div', 'jiratack-ticket-card');
        card.dataset.key = pin.key;

        const keyEl = make('div', 'jiratack-ticket-key', pin.key);
        const summaryEl = make('div', 'jiratack-ticket-summary', pin.summary || '');
        const metaEl = make('div', 'jiratack-ticket-meta');
        const peopleEl = make('div', 'jiratack-ticket-people');
        const inlineEl = make('div', 'jiratack-inline-container');

        card.appendChild(keyEl);
        card.appendChild(summaryEl);
        card.appendChild(metaEl);
        card.appendChild(peopleEl);
        card.appendChild(inlineEl);

        let expanded = false;
        let inlineController = null;

        function renderDetails(includeDoneState) {
          metaEl.innerHTML = '';
          peopleEl.innerHTML = '';

          if (pin.status && pin.status.name) {
            metaEl.appendChild(make('span', 'jiratack-chip jiratack-status', pin.status.name));
          }
          if (pin.priority && pin.priority.name) {
            metaEl.appendChild(make('span', 'jiratack-chip jiratack-priority', pin.priority.name));
          }
          if (pin.issueType && pin.issueType.name) {
            metaEl.appendChild(make('span', 'jiratack-chip jiratack-issuetype', pin.issueType.name));
          }
          if (includeDoneState && isDone(pin)) {
            metaEl.appendChild(make('span', 'jiratack-chip jiratack-done-badge', 'Done'));
            card.classList.add('jiratack-ticket-done');
          }

          addPerson(peopleEl, 'Assignee', pin.assignee);
          addPerson(peopleEl, 'Reporter', pin.reporter);
        }

        renderDetails(true);

        function collapse() {
          expanded = false;
          if (inlineController) {
            controllers.push(inlineController);
            inlineController = null;
          }
          inlineEl.innerHTML = '';
        }

        card.addEventListener('click', (event) => {
          if (event.target.closest && event.target.closest('.jiratack-inline-edit')) return;

          select(pin.key);
          if (onSelect) onSelect(pin);

          if (session && session.scope === 'view') {
            window.open(buildIssueUrl(config, session, pin.key), '_blank', 'noopener');
            return;
          }

          if (isDone(pin)) return;

          if (expanded) {
            collapse();
            return;
          }

          expanded = true;
          inlineController = renderInlineEdit(inlineEl, {
            config,
            session,
            pin,
            refresh: () => renderDetails(false),
            onToast,
            onDone: (changedPin) => {
              if (onDone) onDone({ pin: changedPin, cardEl: card });
              window.setTimeout(() => {
                collapse();
                renderDetails(true);
              }, 2200);
            },
          });
        });

        cards.set(pin.key, card);
        list.appendChild(card);
      });
    }
  }

  function select(key) {
    cards.forEach((card, cardKey) => {
      card.classList.toggle(SELECTED_CLASS, cardKey === key);
    });
  }

  function destroy() {
    controllers.forEach((controller) => {
      try {
        if (controller && controller.destroy) controller.destroy();
      } catch (e) {
        // ignore
      }
    });
    cards.clear();
  }

  return { select, destroy };
}
