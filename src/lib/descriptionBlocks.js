import { PIN_MARKER_PREFIX } from './pinMarker.js';
import { textToAdf } from '../shared/adfText.js';

function nodeText(node) {
  if (!node || !Array.isArray(node.content)) return '';
  for (const child of node.content) {
    if (child && child.type === 'text' && typeof child.text === 'string') return child.text;
    if (child && child.type === 'hardBreak') return '';
  }
  return '';
}

function isMarkerNode(node) {
  return Boolean(node)
    && node.type === 'paragraph'
    && nodeText(node).startsWith(PIN_MARKER_PREFIX);
}

function isGuestPrefixNode(node) {
  return Boolean(node)
    && node.type === 'paragraph'
    && nodeText(node).startsWith('[Guest: ');
}

function isConsoleHeaderNode(node) {
  return Boolean(node)
    && node.type === 'paragraph'
    && nodeText(node).trim() === 'Console output:';
}

/**
 * Separates a JiraTack description into the blocks the server owns and the
 * user-authored body. The body is the only part the inline editor may replace.
 */
export function splitDescription(description) {
  const content = description && Array.isArray(description.content)
    ? description.content.slice()
    : [];

  const marker = content.length > 0 && isMarkerNode(content[content.length - 1])
    ? content.pop()
    : null;

  let consoleNodes = [];
  if (marker && content.length >= 2) {
    const headerIndex = content.length - 2;
    const header = content[headerIndex];
    const code = content[headerIndex + 1];
    if (isConsoleHeaderNode(header) && code && code.type === 'codeBlock') {
      consoleNodes = content.splice(headerIndex);
    }
  }

  const prefix = [];
  while (content.length > 0 && isGuestPrefixNode(content[0])) {
    prefix.push(content.shift());
  }

  return { prefix, body: content, console: consoleNodes, marker };
}

export function mergeDescription(descriptionText, split) {
  const body = textToAdf(descriptionText).content;
  const content = [...split.prefix, ...body, ...split.console];
  if (split.marker) content.push(split.marker);
  return { type: 'doc', version: 1, content };
}
