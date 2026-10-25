const MARK_MAP = {
  bold: 'strong',
  italic: 'em',
  strong: 'strong',
  em: 'em',
};

function serializeMarks(marks) {
  if (!Array.isArray(marks) || marks.length === 0) return undefined;
  const mapped = marks
    .map((m) => MARK_MAP[m && m.type])
    .filter(Boolean)
    .map((type) => ({ type }));
  return mapped.length > 0 ? mapped : undefined;
}

export function serializeInline(node) {
  if (!node) return null;
  if (node.type === 'hardBreak') {
    return { type: 'hardBreak' };
  }
  if (node.type === 'text') {
    const out = { type: 'text', text: node.text || '' };
    const marks = serializeMarks(node.marks);
    if (marks) out.marks = marks;
    return out;
  }
  return serializeNode(node);
}

export function serializeNode(node) {
  if (!node) return null;
  switch (node.type) {
    case 'paragraph': {
      const content = (node.content || []).map(serializeInline).filter(Boolean);
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    case 'bulletList':
    case 'orderedList': {
      const content = (node.content || []).map(serializeNode).filter(Boolean);
      return { type: node.type, content };
    }
    case 'listItem': {
      const content = (node.content || []).map(serializeNode).filter(Boolean);
      return { type: 'listItem', content };
    }
    case 'hardBreak':
      return { type: 'hardBreak' };
    case 'text':
      return serializeInline(node);
    default: {
      console.warn(`[JiraTack] Unsupported ADF node type: ${node.type}`);
      const text = node.text || (node.content ? JSON.stringify(node.content) : '');
      return { type: 'paragraph', content: [{ type: 'text', text }] };
    }
  }
}

export function serializeToAdf(doc) {
  const nodes = Array.isArray(doc) ? doc : (doc && doc.content) || [];
  return {
    type: 'doc',
    version: 1,
    content: nodes.map(serializeNode).filter(Boolean),
  };
}
