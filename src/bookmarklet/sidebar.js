import { renderInlineEdit } from './inlineEdit.js';
import { normalizeUrl, filterPinsByUrl, countPinsByUrl } from '../shared/urlNormalize.js';
import { toSafeHttpUrl } from '../shared/safeUrl.js';

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
  // Stored URLs are untrusted: never assign a non-http(s) scheme to location.
  const safeUrl = toSafeHttpUrl(pin.url, window.location.href);
  if (!safeUrl) return false;
  try {
    const target = new URL(safeUrl);
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
  const activeTextChangeKey = options.activeTextChangeKey || null;
  const activeFilter = options.filter || 'all';
  const matchMode = options.matchMode === 'exact' || options.matchMode === 'path'
    ? options.matchMode
    : 'smart';
  const pageUrl = options.pageUrl || '';
  const loadingLabel = options.loadingLabel || '';
  const loadError = options.loadError || '';
  const composing = Boolean(options.composing);
  const composeListOpen = Boolean(options.composeListOpen);

  container.classList.toggle('jiratack-composing', composing);

  // A visible build stamp: "am I on the new SDK?" must be answerable at a glance.
  function appendVersion(host) {
    // The RUNNING bundle version, not the version frozen in the enrollment
    // config: the latter never changes after the first connect, which made a
    // stale stamp look like a stale build.
    // The build replaces RUNNING_SDK_VERSION with the bundle hash; never compare
    // against the placeholder literal here — the substitution would rewrite it.
    const running = options.runningSdkVersion || 'dev';
    const channel = (options.config && options.config.channel) || 'bookmarklet';
    const enrolled = (options.config && options.config.sdkVersion) || '';
    const suffix = enrolled && enrolled !== running ? ` (enrolled ${enrolled})` : '';
    host.appendChild(make('div', 'jiratack-version', `SDK ${running} · ${channel}${suffix}`));
  }

  const header = container.querySelector('.jiratack-sidebar-header');
  const selectorContainer = container.querySelector('.jiratack-canvas-selector');
  const list = container.querySelector('.jiratack-ticket-list');
  const form = container.querySelector('.jiratack-new-ticket-form');

  header.innerHTML = '';
  if (selectorContainer) selectorContainer.innerHTML = '';
  list.innerHTML = '';
  // In compose mode the form belongs to a live controller; rebuilding the
  // sidebar (polling, pin re-render) must not destroy the draft.
  if (!options.keepForm) form.innerHTML = '';

  const isUniversal = Boolean(options.canvasSelector);
  const isGuest = Boolean(options.guestSelector);

  function makeLayoutRow() {
    const fit = options.layoutMode === 'fit';
    const row = make('div', 'jiratack-layout-row');
    row.appendChild(make('span', 'jiratack-layout-label', 'Fit page'));
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
    select.disabled = composing;
    if (composing) select.title = 'Finish or cancel the ticket first';
    select.addEventListener('change', () => {
      if (options.guestSelector.onChange) options.guestSelector.onChange(select.value);
    });
    wrap.appendChild(select);
    header.appendChild(wrap);

    const badges = make('div', 'jiratack-badges');
    badges.appendChild(make('span', 'jiratack-badge', 'Guest'));
    if (session && session.guestEmail) {
      badges.appendChild(make('span', 'jiratack-badge', session.guestEmail));
    }
    header.appendChild(badges);
    header.appendChild(makeCloseButton());
    appendVersion(header);

    if (selectorContainer) renderHeaderControls();
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
      switchButton.disabled = composing;
      if (composing) switchButton.title = 'Finish or cancel the ticket first';
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
    appendVersion(header);

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
          // Hundreds of canvases need a filter, not one button per canvas (D43).
          let searchBox = null;
          if (canvases.length > 6) {
            searchBox = document.createElement('input');
            searchBox.type = 'search';
            searchBox.className = 'jiratack-canvas-search';
            searchBox.placeholder = `Filter ${canvases.length} canvases…`;
            searchBox.setAttribute('aria-label', 'Filter canvases');
            selectorContainer.appendChild(searchBox);
          }

          const canvasList = make('div', 'jiratack-canvas-list');
          const rows = canvases.map((canvas) => {
            const button = make('button', 'jiratack-canvas-button');
            button.type = 'button';
            button.appendChild(make('span', 'jiratack-canvas-button-name', canvas.canvasName));
            if (canvas.canvasKey) {
              button.appendChild(make('span', 'jiratack-canvas-button-key', canvas.canvasKey));
            }
            button.dataset.name = String(canvas.canvasName || '').toLowerCase();
            button.dataset.key = String(canvas.canvasKey || '').toLowerCase();
            button.addEventListener('click', () => {
              if (options.canvasSelector.onChange) options.canvasSelector.onChange(canvas.canvasName);
            });
            canvasList.appendChild(button);
            return button;
          });
          selectorContainer.appendChild(canvasList);

          if (searchBox) {
            const applyFilter = () => {
              const needle = searchBox.value.trim().toLowerCase();
              rows.forEach((row) => {
                const match = !needle
                  || row.dataset.name.includes(needle)
                  || row.dataset.key.includes(needle);
                row.style.display = match ? '' : 'none';
              });
            };
            searchBox.addEventListener('input', applyFilter);
            searchBox.addEventListener('keydown', (event) => event.stopPropagation());
            searchBox.addEventListener('keyup', (event) => event.stopPropagation());
          }
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
      renderHeaderControls();
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
    appendVersion(header);
    renderHeaderControls();
  }

  function renderHeaderControls() {
    if (!selectorContainer) return;
    if (composing) {
      renderComposeContext(selectorContainer);
    } else {
      renderFilterToggle(selectorContainer);
    }
  }

  function renderComposeContext(container) {
    container.innerHTML = '';
    const row = make('div', 'jiratack-compose-context');
    row.appendChild(make('span', 'jiratack-compose-label', 'Page'));
    const url = make('span', 'jiratack-compose-url', pageUrl || 'This page');
    url.title = pageUrl || '';
    row.appendChild(url);
    container.appendChild(row);
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
    if (activeFilter === 'page') renderMatchRow(container);
    renderStatusRow(container);
  }

  /**
   * View All / Filter By Status (D38, amended). The project's status rule is
   * only the DEFAULT: the reviewer can check exactly which statuses to show,
   * per canvas, and View All is a temporary peek at everything. The count says
   * how many tickets the current choice is holding back.
   */
  function renderStatusRow(container) {
    if (!options.onStatusFilterChange && !options.onStatusToggle) return;
    const status = options.statusState || {
      showAll: false, hiddenCount: 0, groups: [], rule: [], ruleIsDefault: true,
    };
    const hidden = typeof status.hiddenCount === 'number' ? status.hiddenCount : 0;
    const groups = Array.isArray(status.groups) ? status.groups : [];
    const rule = Array.isArray(status.rule) ? status.rule : [];
    const filtered = !status.showAll;
    if (filtered && hidden === 0 && groups.length === 0) return;

    const row = make('div', 'jiratack-match-row jiratack-statusrow');
    const allButton = make(
      'button',
      `jiratack-match-btn${status.showAll ? ' jiratack-match-btn-active' : ''}`,
      'View All',
    );
    allButton.type = 'button';
    allButton.title = 'Show every ticket once, without changing the filter';
    allButton.setAttribute('aria-pressed', status.showAll ? 'true' : 'false');
    allButton.addEventListener('click', () => {
      if (options.onStatusFilterChange) options.onStatusFilterChange('all');
    });
    const filterButton = make(
      'button',
      `jiratack-match-btn${filtered ? ' jiratack-match-btn-active' : ''}`,
      status.showAll && hidden > 0 ? `Filter By Status (${hidden} hidden)` : 'Filter By Status',
    );
    filterButton.type = 'button';
    filterButton.title = 'Show only the statuses ticked in the list';
    filterButton.setAttribute('aria-pressed', filtered ? 'true' : 'false');
    filterButton.addEventListener('click', () => {
      if (options.onStatusFilterChange) options.onStatusFilterChange('filtered');
    });
    const caret = make(
      'button',
      `jiratack-match-btn jiratack-statuscaret${options.statusPanelOpen ? ' jiratack-match-btn-active' : ''}`,
      '▾',
    );
    caret.type = 'button';
    caret.title = 'Choose which statuses to show';
    caret.setAttribute('aria-haspopup', 'true');
    caret.setAttribute('aria-expanded', options.statusPanelOpen ? 'true' : 'false');
    caret.addEventListener('click', () => {
      if (options.onStatusPanelToggle) options.onStatusPanelToggle();
    });
    row.appendChild(allButton);
    row.appendChild(filterButton);
    row.appendChild(caret);
    container.appendChild(row);

    if (!options.statusPanelOpen || !options.onStatusToggle) return;

    const panel = make('div', 'jiratack-statuspanel');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Statuses to show');

    const head = make('div', 'jiratack-statuspanel-head');
    const makeAction = (label, title, handler, active) => {
      const button = make('button', `jiratack-statuspanel-action${active ? ' jiratack-match-btn-active' : ''}`, label);
      button.type = 'button';
      button.title = title;
      button.addEventListener('click', handler);
      return button;
    };
    head.appendChild(makeAction('All', 'Show every status', () => options.onStatusAll && options.onStatusAll(), hidden === 0));
    head.appendChild(makeAction('None', 'Hide every status on this canvas', () => options.onStatusNone && options.onStatusNone(), false));
    head.appendChild(makeAction(
      'Reset',
      'Return to the project default',
      () => options.onStatusReset && options.onStatusReset(),
      Boolean(status.ruleIsDefault),
    ));
    panel.appendChild(head);

    if (groups.length === 0) {
      panel.appendChild(make('div', 'jiratack-statuspanel-empty', 'No tickets carry a status here.'));
    }
    groups.forEach((group) => {
      const shown = !rule.includes(group.name) && !status.showAll;
      const option = make('label', 'jiratack-statusoption');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = shown;
      box.addEventListener('change', () => {
        if (options.onStatusToggle) options.onStatusToggle(group.name, box.checked);
      });
      option.appendChild(box);
      option.appendChild(make('span', 'jiratack-statusoption-name', group.name));
      option.appendChild(make('span', 'jiratack-statusoption-count', String(group.count)));
      panel.appendChild(option);
    });

    if (status.ruleIsDefault) {
      panel.appendChild(make('div', 'jiratack-statuspanel-hint', 'Using the project default. Tick to override for this canvas.'));
    }

    const done = make('button', 'jiratack-statuspanel-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => {
      if (options.onStatusPanelToggle) options.onStatusPanelToggle();
    });
    panel.appendChild(done);
    container.appendChild(panel);
  }

  /**
   * Offered only when the three modes disagree. The counts are the whole point:
   * "Smart 2 / Whole page 5" tells a reviewer that four sibling URLs were merged
   * without asking them to understand query strings.
   */
  function renderMatchRow(container) {
    if (!pageUrl) return;
    const counts = countPinsByUrl(pins, pageUrl);
    if (counts.smart === counts.exact && counts.smart === counts.path) return;

    const row = make('div', 'jiratack-match-row');
    row.appendChild(make('span', 'jiratack-match-label', 'Match'));
    const modes = [
      { mode: 'smart', label: 'Smart', count: counts.smart, title: 'Ignore tracking and per-visit parameters' },
      { mode: 'exact', label: 'Exact', count: counts.exact, title: 'Only this exact URL, query included' },
      { mode: 'path', label: 'Whole page', count: counts.path, title: 'Every pin on this path, ignoring the query string' },
    ];
    modes.forEach(({ mode, label, count, title }) => {
      const active = mode === matchMode;
      const button = make(
        'button',
        `jiratack-match-btn${active ? ' jiratack-match-btn-active' : ''}`,
        `${label} ${count}`,
      );
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (options.onMatchModeChange) options.onMatchModeChange(mode);
      });
      row.appendChild(button);
    });
    container.appendChild(row);
  }

  const visiblePins = activeFilter === 'page' && pageUrl
    ? filterPinsByUrl(pins, pageUrl, matchMode)
    : (pins || []);

  const cards = new Map();
  const cardControllers = new Map();
  // Accordion: at most one card is expanded at a time (D33 follow-up).
  let openCardKey = null;
  const textChangeControls = new Map();
  const controllers = [];

  function buildCard(pin) {
    const card = make('div', 'jiratack-ticket-card');
    card.dataset.key = pin.key;

    const isPending = Boolean(pin.pending);
    if (isPending) card.classList.add('jiratack-ticket-pending');

    const pinUrlNorm = pin.url ? normalizeUrl(pin.url) : null;
    const pageUrlNorm = normalizeUrl(window.location.href);
    const isCrossPage = Boolean(pinUrlNorm && pinUrlNorm !== pageUrlNorm);

    // A pending save has no key yet: show the state, not a dead link.
    const keyEl = isPending
      ? make('span', 'jiratack-ticket-key jiratack-pending-key', 'Saving…')
      : make('a', 'jiratack-ticket-key', pin.key);
    if (!isPending) {
      keyEl.href = buildIssueUrl(config, session, pin.key);
      keyEl.target = '_blank';
      keyEl.rel = 'noopener noreferrer';
      keyEl.addEventListener('click', (event) => event.stopPropagation());
    }

    card.addEventListener('mouseenter', () => {
      if (onHover) onHover(pin);
    });
    card.addEventListener('mouseleave', () => {
      if (onHover) onHover(null);
    });

    const summaryEl = make('div', 'jiratack-ticket-summary', pin.summary || '');

    // The stored pair is the label; the switch is the post-creation preview
    // (D35). Only tickets created with a text change have it.
    if (pin.textChange && pin.textChange.original && pin.textChange.suggested) {
      const pairText = `${pin.textChange.original} → ${pin.textChange.suggested}`;
      const row = make('div', 'jiratack-ticket-textchange');
      const pair = make('span', 'jiratack-ticket-textchange-pair');
      pair.title = pairText;
      pair.appendChild(make('span', 'jiratack-ticket-textchange-original', pin.textChange.original));
      pair.appendChild(make('span', 'jiratack-ticket-textchange-arrow', ' → '));
      pair.appendChild(make('span', 'jiratack-ticket-textchange-suggested', pin.textChange.suggested));
      const toggle = make('button', 'jiratack-switch jiratack-textchange-switch');
      toggle.type = 'button';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', 'Preview text change on page');
      toggle.title = 'Preview text change on page';
      const on = activeTextChangeKey === pin.key;
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) toggle.classList.add('jiratack-switch-on');
      const track = make('span', 'jiratack-switch-track');
      track.appendChild(make('span', 'jiratack-switch-knob'));
      toggle.appendChild(track);
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (options.onTextChangeToggle) options.onTextChangeToggle(pin);
      });
      row.appendChild(pair);
      row.appendChild(toggle);
      card.appendChild(row);
      textChangeControls.set(pin.key, toggle);
    }

    const metaEl = make('div', 'jiratack-ticket-meta');
    const peopleEl = make('div', 'jiratack-ticket-people');
    const inlineEl = make('div', 'jiratack-inline-container');

    card.appendChild(keyEl);
    card.appendChild(summaryEl);
    card.appendChild(metaEl);
    card.appendChild(peopleEl);
    if (isCrossPage) {
      card.appendChild(
        make(
          'div',
          'jiratack-ticket-hint',
          'Opens another page — reopen JiraTack there.',
        ),
      );
    }
    card.appendChild(inlineEl);

    let expanded = false;
    let inlineController = null;

    function renderSummary() {
      summaryEl.textContent = pin.summary || '';
    }

    function renderDetails(includeDoneState) {
      metaEl.innerHTML = '';
      peopleEl.innerHTML = '';

      if (isPending) {
        metaEl.appendChild(make('span', 'jiratack-chip jiratack-pending-chip', 'Saving…'));
        return;
      }

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
      if (openCardKey === pin.key) openCardKey = null;
      if (inlineController) {
        controllers.push(inlineController);
        inlineController = null;
      }
      inlineEl.innerHTML = '';
    }

    card.addEventListener('click', (event) => {
      if (isPending) return;
      if (event.target.closest && event.target.closest('.jiratack-inline-edit')) return;

      const pinUrl = pin.url ? normalizeUrl(pin.url) : null;
      const currentUrl = normalizeUrl(window.location.href);
      if (pinUrl && pinUrl !== currentUrl) {
        let timer = null;
        let navigated = false;
        const proceed = () => {
          if (navigated) return;
          navigated = true;
          if (timer) {
            window.clearTimeout(timer);
            timer = null;
          }
          navigateToPin(pin, canvasName);
        };
        const delay = options.onBeforeNavigate ? options.onBeforeNavigate(pin, proceed) : 0;
        if (delay > 0) {
          timer = window.setTimeout(proceed, delay);
        } else {
          proceed();
        }
        return;
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

      if (openCardKey && openCardKey !== pin.key) {
        const previous = cardControllers.get(openCardKey);
        if (previous && typeof previous.collapse === 'function') previous.collapse();
      }
      openCardKey = pin.key;
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

  function renderComposeList() {
    const pagePins = pageUrl ? filterPinsByUrl(pins || [], pageUrl, matchMode) : (pins || []);
    const count = pagePins.length;
    const toggle = make('button', 'jiratack-compose-list-toggle');
    toggle.type = 'button';
    toggle.disabled = count === 0;
    toggle.setAttribute('aria-expanded', composeListOpen && count > 0 ? 'true' : 'false');
    toggle.appendChild(make(
      'span',
      null,
      count === 0
        ? 'No other tickets on this page'
        : `${count} other ticket${count === 1 ? '' : 's'} on this page`,
    ));
    if (count > 0) {
      toggle.appendChild(make('span', 'jiratack-compose-caret', composeListOpen ? '▾' : '▸'));
      if (options.onToggleComposeList) {
        toggle.addEventListener('click', options.onToggleComposeList);
      }
    }
    list.appendChild(toggle);
    if (composeListOpen && count > 0) {
      const wrap = make('div', 'jiratack-compose-list');
      pagePins.forEach((pin) => wrap.appendChild(buildCard(pin)));
      list.appendChild(wrap);
    }
  }

  if (composing) {
    renderComposeList();
  } else if (loadError && (!isUniversal || universalHasCanvas)) {
    list.appendChild(make('div', 'jiratack-canvas-error', loadError));
  } else if (options.loading && (!isUniversal || universalHasCanvas)) {
    list.appendChild(loadingNode(loadingLabel || 'Loading pins…'));
    list.appendChild(skeletonTickets());
  } else if (!isUniversal || universalHasCanvas) {
    if (!visiblePins || visiblePins.length === 0) {
      const counts = pageUrl ? countPinsByUrl(pins, pageUrl) : { smart: 0, exact: 0, path: 0 };
      const canWiden = activeFilter === 'page'
        && matchMode !== 'path'
        && counts.path > (matchMode === 'exact' ? counts.exact : counts.smart);
      if (canWiden) {
        const empty = make('div', 'jiratack-empty', 'No pins match this URL.');
        const rescue = make('button', 'jiratack-match-rescue', `Show all ${counts.path} on this page`);
        rescue.type = 'button';
        rescue.addEventListener('click', () => {
          if (options.onMatchModeChange) options.onMatchModeChange('path');
        });
        empty.appendChild(document.createElement('br'));
        empty.appendChild(rescue);
        list.appendChild(empty);
      } else {
        const empty = make('div', 'jiratack-empty', options.emptyMessage || 'No pins on this page.');
        const statusStateNow = options.statusState || {};
        const hiddenNow = typeof statusStateNow.hiddenCount === 'number' ? statusStateNow.hiddenCount : 0;
        if (!statusStateNow.showAll && hiddenNow > 0 && options.onStatusFilterChange) {
          empty.appendChild(document.createElement('br'));
          const rescue = make('button', 'jiratack-match-rescue', `Show ${hiddenNow} filtered ticket${hiddenNow === 1 ? '' : 's'}`);
          rescue.type = 'button';
          rescue.addEventListener('click', () => options.onStatusFilterChange('all'));
          empty.appendChild(rescue);
        }
        list.appendChild(empty);
      }
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

  function setTextChangeActive(key) {
    textChangeControls.forEach((toggle, pinKey) => {
      const on = pinKey === key;
      toggle.classList.toggle('jiratack-switch-on', on);
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
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
    textChangeControls.clear();
  }

  return { select, updatePin, setHover, getKeys, setTextChangeActive, destroy };
}
