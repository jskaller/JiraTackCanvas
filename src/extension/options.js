import { parseBookmarkletConfig, describeConfig } from './extensionConfig.js';

const input = document.getElementById('input');
const status = document.getElementById('status');
const KEY = 'jiratackConfig';

function render(config) {
  status.textContent = describeConfig(config);
}

chrome.storage.local.get([KEY], (result) => {
  render(result && result[KEY]);
});

document.getElementById('save').addEventListener('click', () => {
  const config = parseBookmarkletConfig(input.value);
  if (!config) {
    status.textContent = 'That is not a JiraTack bookmarklet link. Copy the whole javascript: link.';
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
