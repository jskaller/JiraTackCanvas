import { textToAdf } from '../shared/adfText.js';

function nodeText(node) {
  if (!node || !Array.isArray(node.content)) return '';
  for (const child of node.content) {
    if (child && child.type === 'text' && typeof child.text === 'string') return child.text;
    if (child && child.type === 'hardBreak') return '';
  }
  return '';
}

function isHeaderNode(node) {
  return Boolean(node)
    && node.type === 'paragraph'
    && nodeText(node).startsWith('[JiraTack');
}

function isPageFooterNode(node) {
  if (!node || node.type !== 'paragraph' || !Array.isArray(node.content)) return false;
  const first = node.content.find((child) => child && child.type === 'text');
  return Boolean(first) && String(first.text).startsWith('Page:');
}

function isConsoleHeaderNode(node) {
  return Boolean(node)
    && node.type === 'paragraph'
    && nodeText(node).trim() === 'Console output:';
}

/**
 * Splits a JiraTack description into server-owned blocks (header, optional
 * console output, page footer) and the user-authored body.
 */
export function splitDescription(description) {
  const content = description && Array.isArray(description.content)
    ? description.content.slice()
    : [];

  const header = content.length > 0 && isHeaderNode(content[0]) ? content.shift() : null;
  const footer = content.length > 0 && isPageFooterNode(content[content.length - 1])
    ? content.pop()
    : null;

  let consoleNodes = [];
  if (content.length >= 2) {
    const headerIndex = content.length - 2;
    const consoleHeader = content[headerIndex];
    const code = content[headerIndex + 1];
    if (isConsoleHeaderNode(consoleHeader) && code && code.type === 'codeBlock') {
      consoleNodes = content.splice(headerIndex);
    }
  }

  return { header, body: content, console: consoleNodes, footer };
}

export function mergeDescription(descriptionText, split) {
  const body = textToAdf(descriptionText).content;
  const content = [];
  if (split.header) content.push(split.header);
  content.push(...body);
  content.push(...split.console);
  if (split.footer) content.push(split.footer);
  return { type: 'doc', version: 1, content };
}
