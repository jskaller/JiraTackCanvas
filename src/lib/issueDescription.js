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
 * Human-readable description:
 *   [JiraTack Guest: Name]  (or [JiraTack])
 *   <user text>
 *   <optional console output code block>
 *   Page: <link>
 */
export function buildIssueDescription({ guest, bodyAdf, bodyText, consoleLog, pageUrl }) {
  const content = [headerNode(guest)];

  let body = [];
  if (bodyAdf && Array.isArray(bodyAdf.content)) {
    body = bodyAdf.content;
  } else if (typeof bodyText === 'string') {
    body = textToAdf(bodyText).content;
  }
  content.push(...body);

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
