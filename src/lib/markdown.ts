/**
 * Serialise the journal editor's ProseMirror/Tiptap document to Markdown.
 *
 * Covers exactly the node & mark set that `StarterKit` (headings limited to
 * 2–3) produces in `journal/editor.tsx`. Unknown nodes fall through to their
 * children's text so nothing is silently dropped.
 */

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PMNode {
  type?: string;
  text?: string;
  content?: PMNode[];
  marks?: PMMark[];
  attrs?: Record<string, unknown>;
}

function applyMarks(text: string, marks: PMMark[] = []): string {
  const has = (t: string): boolean => marks.some((m) => m.type === t);
  let out = text;
  if (has('code')) out = `\`${out}\``;
  if (has('bold')) out = `**${out}**`;
  if (has('italic')) out = `*${out}*`;
  if (has('strike')) out = `~~${out}~~`;
  const link = marks.find((m) => m.type === 'link');
  if (link && typeof link.attrs?.href === 'string') {
    out = `[${out}](${link.attrs.href})`;
  }
  return out;
}

function inline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return applyMarks(n.text ?? '', n.marks);
      if (n.type === 'hardBreak') return '  \n';
      return n.content ? inline(n.content) : '';
    })
    .join('');
}

function listBlock(node: PMNode, ordered: boolean): string {
  return (node.content ?? [])
    .map((item, i) => {
      const marker = ordered ? `${i + 1}. ` : '- ';
      return blocks(item.content ?? [])
        .split('\n')
        .map((line, idx) => {
          if (idx === 0) return marker + line;
          return line ? `  ${line}` : line;
        })
        .join('\n');
    })
    .join('\n');
}

function block(node: PMNode): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content);
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
      return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inline(node.content)}`;
    }
    case 'bulletList':
      return listBlock(node, false);
    case 'orderedList':
      return listBlock(node, true);
    case 'blockquote':
      return blocks(node.content ?? [])
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `\`\`\`${lang}\n${inline(node.content)}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    default:
      return node.content ? blocks(node.content) : '';
  }
}

function blocks(nodes: PMNode[]): string {
  return nodes
    .map(block)
    .filter((s) => s.length > 0)
    .join('\n\n');
}

export const proseMirrorToMarkdown = (doc: unknown): string => {
  const root = doc as PMNode | null;
  if (!root?.content) return '';
  return blocks(root.content).trim();
};
