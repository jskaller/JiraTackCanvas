import { parseBookmarkletConfig, describeConfig } from './extensionConfig.js';

const input = document.getElementById('input');
const status = document.getElementById('status');
const KEY = 'jiratackConfig';

function render(config) {
  status.textContent = describeConfig(config);
}

chrome.storage.local.get([KEY, 'jiratackPendingConfig'], (result) => {
  render(result && result[KEY]);
  const pending = result && result.jiratackPendingConfig;
  if (pending) {
    const banner = document.getElementById('pending');
    const detail = document.getElementById('pending-detail');
    if (banner && detail) {
      banner.hidden = false;
      detail.textContent = pending.apiUrl || 'a different JiraTack installation';
    }
  }
});

document.getElementById('replace').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'jiratack-replace-config' }, () => {
    void chrome.runtime.lastError;
    chrome.storage.local.get([KEY], (result) => {
      render(result && result[KEY]);
      const banner = document.getElementById('pending');
      if (banner) banner.hidden = true;
    });
  });
});

document.getElementById('keep').addEventListener('click', () => {
  chrome.storage.local.remove(['jiratackPendingConfig'], () => {
    const banner = document.getElementById('pending');
    if (banner) banner.hidden = true;
  });
});

document.getElementById('save').addEventListener('click', () => {
  const config = parseBookmarkletConfig(input.value);
  if (!config) {
    status.textContent = 'That is not a JiraTack canvas link. Copy the whole javascript: link.';
    return;
  }
  chrome.storage.local.set({ [KEY]: config }, () => {
    input.value = '';
    render(config);
  });
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.remove([KEY], () => render(null));
});
