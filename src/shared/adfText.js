function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') {
    return (node.attrs && (node.attrs.text || node.attrs.displayName)) || '';
  }
  if (Array.isArray(node.content)) {
    return node.content.map(inlineText).join('');
  }
  return '';
}

export function adfToText(adf) {
  const nodes = Array.isArray(adf) ? adf : (adf && adf.content) || [];
  const lines = [];

  nodes.forEach((node) => {
    if (!node) return;
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      lines.push(inlineText(node));
      return;
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      (node.content || []).forEach((item) => {
        lines.push(adfToText(item));
      });
      return;
    }
    if (node.type === 'listItem' || node.type === 'blockquote' || node.type === 'panel') {
      lines.push(adfToText(node));
      return;
    }
    lines.push(inlineText(node));
  });

  return lines.join('\n');
}

export function textToAdf(text) {
  const normalized = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
  if (normalized.length === 0) {
    return { type: 'doc', version: 1, content: [] };
  }

  const content = normalized.split('\n').map((line) => {
    if (line.length === 0) return { type: 'paragraph' };
    return { type: 'paragraph', content: [{ type: 'text', text: line }] };
  });

  return { type: 'doc', version: 1, content };
}
