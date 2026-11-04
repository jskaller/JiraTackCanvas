import { textToAdf } from '../shared/adfText.js';

function headerNode(guest) {
  const text = guest && guest.name ? `[JiraTack Guest: ${guest.name}]` : '[JiraTack]';
  return {
    type: 'paragraph',
    content: [{ type: 'text', text, marks: [{ type: 'strong' }] }],
  };
}

function linkNode(url) {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Page: ' },
      { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
    ],
  };
}

/**
 * One "Label: value" line for a canvas auxiliary field (D41). A bare URL gets a
 * link mark so it is clickable, everything else stays literal text.
 */
function extraNode(label, value) {
  const content = [{ type: 'text', text: `${label}: `, marks: [{ type: 'strong' }] }];
  if (/^https?:\/\/\S+$/i.test(value)) {
    content.push({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href: value } }] });
  } else {
    content.push({ type: 'text', text: value });
  }
  return { type: 'paragraph', content };
}

/**
 * Human-readable description:
 *   [JiraTack Guest: Name]  (or [JiraTack])
 *   <user text>
 *   <canvas auxiliary fields, D41>
 *   <optional console output code block>
 *   Page: <link>
 */
export function buildIssueDescription({ guest, bodyAdf, bodyText, consoleLog, pageUrl, extras }) {
  const content = [headerNode(guest)];

  let body = [];
  if (bodyAdf && Array.isArray(bodyAdf.content)) {
    body = bodyAdf.content;
  } else if (typeof bodyText === 'string') {
    body = textToAdf(bodyText).content;
  }
  content.push(...body);

  (Array.isArray(extras) ? extras : []).forEach((extra) => {
    if (!extra || !extra.label || !extra.value) return;
    content.push(extraNode(extra.label, extra.value));
  });

  if (typeof consoleLog === 'string' && consoleLog.length > 0) {
    content.push(
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Console output:', marks: [{ type: 'strong' }] }],
      },
      { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: consoleLog }] },
    );
  }

  if (typeof pageUrl === 'string' && pageUrl.length > 0) {
    content.push(linkNode(pageUrl));
  }

  return { type: 'doc', version: 1, content };
}
