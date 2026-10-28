import { renderInlineEdit } from './inlineEdit.js';
import { normalizeUrl } from '../shared/urlNormalize.js';

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

function navigateToPin(pin, canvasName) {
  if (!pin.url) return false;
  try {
    const target = new URL(pin.url, window.location.href);
    target.searchParams.set('jiratack_ticket', pin.key);
    if (canvasName) {
      target.searchParams.set('jiratack_canvas', canvasName);
    }
    window.location.href = target.toString();
    return true;
  } catch (e) {
    return false;
  }
}

function addPerson(container, label, user) {
  const name = user && user.displayName ? user.displayName : '—';
  const row = make('span', 'jiratack-person');
  row.title = `${label}: ${name}`;
  row.appendChild(make('span', 'jiratack-person-label', `${label}:`));

  if (user && user.avatarUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'jiratack-avatar';
    avatar.src = user.avatarUrl;
    avatar.alt = '';
    row.appendChild(avatar);
  } else {
    const initial = name !== '—' ? name.trim().charAt(0).toUpperCase() : '–';
    row.appendChild(make('span', 'jiratack-avatar jiratack-avatar-empty', initial));
  }

  row.appendChild(make('span', 'jiratack-person-name', name));
  container.appendChild(row);
}

function isDone(pin) {
  return Boolean(pin && pin.status && pin.status.category === 'done');
}

function addChip(container, className, label, value) {
  if (!value) return;
  const chip = make('span', `jiratack-chip ${className}`);
  chip.appendChild(make('span', 'jiratack-chip-label', `${label}:`));
  chip.appendChild(make('span', 'jiratack-chip-value', value));
  container.appendChild(chip);
}

function loadingNode(label) {
  const wrap = make('div', 'jiratack-loading');
  wrap.appendChild(make('span', 'jiratack-spinner'));
  wrap.appendChild(make('span', null, label));
  return wrap;
}

function skeletonTickets() {
  const wrap = make('div', 'jiratack-skeleton-list');
  for (let i = 0; i < 3; i += 1) {
    const card = make('div', 'jiratack-skeleton-card');
    card.appendChild(make('div', 'jiratack-skeleton-line jiratack-skeleton-line-key'));
    card.appendChild(make('div', 'jiratack-skeleton-line jiratack-skeleton-line-summary'));
    card.appendChild(make('div', 'jiratack-skeleton-line jiratack-skeleton-line-meta'));
    card.appendChild(make('div', 'jiratack-skeleton-line jiratack-skeleton-line-people'));
    wrap.appendChild(card);
  }
  return wrap;
}

function skeletonCanvases() {
  const wrap = make('div', 'jiratack-skeleton-list');
  for (let i = 0; i < 3; i += 1) {
    wrap.appendChild(make('div', 'jiratack-skeleton-line jiratack-skeleton-line-canvas'));
  }
  return wrap;
}

function makeCloseButton() {
  const button = make('button', 'jiratack-close', '×');
  button.type = 'button';
  button.title = 'Close';
  button.addEventListener('click', () => {
    if (window.__jiratackClose) window.__jiratackClose();
  });
  return button;
}

export function renderSidebar(container, options) {
  const { canvasName, session, pins, config, onSelect, onToast, onDone, onEditStart, onHover } = options;
  const activeFilter = options.filter || 'all';
  const pageUrl = options.pageUrl || '';
  const loadingLabel = options.loadingLabel || '';
  const loadError = options.loadError || '';

  const header = container.querySelector('.jiratack-sidebar-header');
  const selectorContainer = container.querySelector('.jiratack-canvas-selector');
  const list = container.querySelector('.jiratack-ticket-list');
  const form = container.querySelector('.jiratack-new-ticket-form');

  header.innerHTML = '';
  if (selectorContainer) selectorContainer.innerHTML = '';
  list.innerHTML = '';
  form.innerHTML = '';

  const isUniversal = Boolean(options.canvasSelector);
  const isGuest = Boolean(options.guestSelector);

  function makeLayoutRow() {
    const fit = options.layoutMode === 'fit';
    const row = make('div', 'jiratack-layout-row');
    row.appendChild(make('span', 'jiratack-layout-label', 'Fit to sidebar'));
    const toggle = make(
      'button',
      `jiratack-layout-switch${fit ? ' jiratack-layout-switch-on' : ''}`,
    );
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', fit ? 'true' : 'false');
    toggle.setAttribute('aria-label', 'Fit page to sidebar');
    toggle.title = fit ? 'Show the page at actual size' : 'Shrink the page to fit beside the sidebar';
    toggle.appendChild(make('span', 'jiratack-layout-knob'));
    toggle.addEventListener('click', () => {
      if (options.onLayoutModeChange) {
        options.onLayoutModeChange(fit ? 'push' : 'fit');
      }
    });
    row.appendChild(toggle);
    return row;
  }

  if (isGuest) {
    const wrap = make('div', 'jiratack-guest-canvas');
    wrap.appendChild(make('span', 'jiratack-guest-canvas-label', 'Canvas'));

    const select = make('select', 'jiratack-canvas-dropdown');
    (options.guestSelector.canvases || []).forEach((name) => {
      const option = make('option', null, name);
      option.value = name;
      select.appendChild(option);
    });
    if (canvasName) select.value = canvasName;
    select.addEventListener('change', () => {
      if (options.guestSelector.onChange) options.guestSelector.onChange(select.value);
    });
    wrap.appendChild(select);
    header.appendChild(wrap);

    const badges = make('div', 'jiratack-badges');
    badges.appendChild(make('span', 'jiratack-badge', 'Guest'));
    header.appendChild(badges);
    header.appendChild(makeCloseButton());

    if (selectorContainer) renderFilterToggle(selectorContainer);
  } else if (isUniversal) {
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
    header.appendChild(makeCloseButton());

    if (!hasSelectedCanvas) {
      if (loadError) {
        selectorContainer.appendChild(make('div', 'jiratack-canvas-error', loadError));
      } else if (options.loading) {
        selectorContainer.appendChild(loadingNode(loadingLabel || 'Loading canvases…'));
        selectorContainer.appendChild(skeletonCanvases());
      } else {
        selectorContainer.appendChild(makeLayoutRow());
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
      }
    } else {
      selectorContainer.innerHTML = '';
      renderFilterToggle(selectorContainer);
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
    header.appendChild(makeCloseButton());
    if (selectorContainer) renderFilterToggle(selectorContainer);
    if (selectorContainer) renderFilterToggle(selectorContainer);
  }

  function renderFilterToggle(container) {
    container.innerHTML = '';
    container.appendChild(makeLayoutRow());
    const wrap = make('div', 'jiratack-filter-toggle');
    const allButton = make('button', activeFilter === 'all' ? 'jiratack-filter-active' : '', 'All Tickets');
    allButton.type = 'button';
    allButton.addEventListener('click', () => {
      if (options.onFilterChange) options.onFilterChange('all');
    });
    const pageButton = make(
      'button',
      activeFilter === 'page' ? 'jiratack-filter-active' : '',
      'Current Page',
    );
    pageButton.type = 'button';
    pageButton.addEventListener('click', () => {
      if (options.onFilterChange) options.onFilterChange('page');
    });
    wrap.appendChild(allButton);
    wrap.appendChild(pageButton);
    container.appendChild(wrap);
  }

  const visiblePins = activeFilter === 'page' && pageUrl
    ? (pins || []).filter((pin) => pin.url && normalizeUrl(pin.url) === normalizeUrl(pageUrl))
    : (pins || []);

  const cards = new Map();
  const cardControllers = new Map();
  const controllers = [];

  function buildCard(pin) {
    const card = make('div', 'jiratack-ticket-card');
    card.dataset.key = pin.key;

    const keyEl = make('a', 'jiratack-ticket-key', pin.key);
    keyEl.href = buildIssueUrl(config, session, pin.key);
    keyEl.target = '_blank';
    keyEl.rel = 'noopener noreferrer';
    keyEl.addEventListener('click', (event) => event.stopPropagation());

    card.addEventListener('mouseenter', () => {
      if (onHover) onHover(pin);
    });
    card.addEventListener('mouseleave', () => {
      if (onHover) onHover(null);
    });

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

    function renderSummary() {
      summaryEl.textContent = pin.summary || '';
    }

    function renderDetails(includeDoneState) {
      metaEl.innerHTML = '';
      peopleEl.innerHTML = '';

      if (pin.status && pin.status.name) {
        addChip(metaEl, 'jiratack-status', 'Status', pin.status.name);
      }
      if (pin.priority && pin.priority.name) {
        addChip(metaEl, 'jiratack-priority', 'Priority', pin.priority.name);
      }
      if (pin.issueType && pin.issueType.name) {
        addChip(metaEl, 'jiratack-issuetype', 'Type', pin.issueType.name);
      }
      if (includeDoneState && isDone(pin)) {
        metaEl.appendChild(make('span', 'jiratack-chip jiratack-done-badge', 'Done'));
        card.classList.add('jiratack-ticket-done');
      }

      addPerson(peopleEl, 'Assignee', pin.assignee);
      addPerson(peopleEl, 'Reporter', pin.reporter);
    }

    function renderCard() {
      renderSummary();
      renderDetails(false);
    }

    renderSummary();
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

      const pinUrl = pin.url ? normalizeUrl(pin.url) : null;
      const currentUrl = normalizeUrl(window.location.href);
      if (pinUrl && pinUrl !== currentUrl) {
        if (navigateToPin(pin, canvasName)) return;
      }

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
        refresh: renderCard,
        onToast,
        onEditStart,
        onDone: (changedPin) => {
          if (onDone) onDone({ pin: changedPin, cardEl: card });
          window.setTimeout(() => {
            collapse();
            renderSummary();
            renderDetails(true);
          }, 2200);
        },
      });
    });

    cards.set(pin.key, card);
    cardControllers.set(pin.key, {
      pin,
      renderCard,
      collapse,
    });
    return card;
  }

  const universalHasCanvas = Boolean(canvasName && canvasName !== 'JiraTack Launcher');
  if (loadError && (!isUniversal || universalHasCanvas)) {
    list.appendChild(make('div', 'jiratack-canvas-error', loadError));
  } else if (options.loading && (!isUniversal || universalHasCanvas)) {
    list.appendChild(loadingNode(loadingLabel || 'Loading pins…'));
    list.appendChild(skeletonTickets());
  } else if (!isUniversal || universalHasCanvas) {
    if (!visiblePins || visiblePins.length === 0) {
      list.appendChild(make('div', 'jiratack-empty', options.emptyMessage || 'No pins on this page.'));
    } else if (activeFilter === 'all') {
      const groups = new Map();
      visiblePins.forEach((pin) => {
        const key = pin.url ? normalizeUrl(pin.url) : '__none__';
        if (!groups.has(key)) {
          groups.set(key, { url: pin.url || 'No URL', pins: [] });
        }
        groups.get(key).pins.push(pin);
      });

      Array.from(groups.values())
        .sort((a, b) => a.url.localeCompare(b.url))
        .forEach((group) => {
          const groupEl = make('div', 'jiratack-url-group');
          const header = make(
            'button',
            'jiratack-url-group-header',
            `${group.url} (${group.pins.length})`,
          );
          header.type = 'button';
          const cardsWrap = make('div', 'jiratack-url-group-cards');
          group.pins.forEach((pin) => cardsWrap.appendChild(buildCard(pin)));
          header.addEventListener('click', () => {
            const collapsed = groupEl.classList.toggle('jiratack-url-group-collapsed');
            cardsWrap.style.display = collapsed ? 'none' : '';
          });
          groupEl.appendChild(header);
          groupEl.appendChild(cardsWrap);
          list.appendChild(groupEl);
        });
    } else {
      visiblePins.forEach((pin) => list.appendChild(buildCard(pin)));
    }
  }

  function select(key) {
    cards.forEach((card, cardKey) => {
      card.classList.toggle(SELECTED_CLASS, cardKey === key);
    });
  }

  function updatePin(key, nextPin) {
    const controller = cardControllers.get(key);
    if (!controller) return false;
    Object.assign(controller.pin, nextPin);
    controller.renderCard();
    return true;
  }

  function setHover(key) {
    cards.forEach((card, cardKey) => {
      card.classList.toggle('jiratack-ticket-hovered', cardKey === key);
    });
  }

  function getKeys() {
    return Array.from(container.querySelectorAll('.jiratack-ticket-card'))
      .map((el) => el.dataset.key)
      .filter(Boolean);
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
    cardControllers.clear();
  }

  return { select, updatePin, setHover, getKeys, destroy };
}
