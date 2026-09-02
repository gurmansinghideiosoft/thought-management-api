import assert from 'node:assert/strict';
import test from 'node:test';

import { proseMirrorToMarkdown } from './markdown.ts';

interface N {
  type: string;
  text?: string;
  content?: N[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

const doc = (...content: N[]): N => ({ type: 'doc', content });
const p = (...content: N[]): N => ({ type: 'paragraph', content });
const t = (text: string, marks?: N['marks']): N => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const li = (...content: N[]): N => ({ type: 'listItem', content });

test('an empty or contentless doc is the empty string', () => {
  assert.equal(proseMirrorToMarkdown({ type: 'doc', content: [] }), '');
  assert.equal(proseMirrorToMarkdown({}), '');
});

test('paragraphs are separated by a blank line', () => {
  assert.equal(proseMirrorToMarkdown(doc(p(t('one')), p(t('two')))), 'one\n\ntwo');
});

test('headings use # by level', () => {
  const d = doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('Big')] },
    { type: 'heading', attrs: { level: 3 }, content: [t('Small')] },
  );
  assert.equal(proseMirrorToMarkdown(d), '## Big\n\n### Small');
});

test('inline marks: bold, italic, strike, code', () => {
  const d = doc(
    p(
      t('a '),
      t('b', [{ type: 'bold' }]),
      t(' '),
      t('i', [{ type: 'italic' }]),
      t(' '),
      t('s', [{ type: 'strike' }]),
      t(' '),
      t('c', [{ type: 'code' }]),
    ),
  );
  assert.equal(proseMirrorToMarkdown(d), 'a **b** *i* ~~s~~ `c`');
});

test('links render as [text](href)', () => {
  const d = doc(
    p(t('see '), t('here', [{ type: 'link', attrs: { href: 'https://x.dev' } }])),
  );
  assert.equal(proseMirrorToMarkdown(d), 'see [here](https://x.dev)');
});

test('bullet and ordered lists', () => {
  assert.equal(
    proseMirrorToMarkdown(
      doc({ type: 'bulletList', content: [li(p(t('one'))), li(p(t('two')))] }),
    ),
    '- one\n- two',
  );
  assert.equal(
    proseMirrorToMarkdown(
      doc({ type: 'orderedList', content: [li(p(t('first'))), li(p(t('second')))] }),
    ),
    '1. first\n2. second',
  );
});

test('a nested list is indented under its item', () => {
  const d = doc({
    type: 'bulletList',
    content: [
      li(p(t('parent')), {
        type: 'bulletList',
        content: [li(p(t('child')))],
      }),
    ],
  });
  assert.equal(proseMirrorToMarkdown(d), '- parent\n\n  - child');
});

test('blockquote prefixes each line', () => {
  const d = doc({ type: 'blockquote', content: [p(t('quoted'))] });
  assert.equal(proseMirrorToMarkdown(d), '> quoted');
});

test('code block keeps its language fence', () => {
  const d = doc({
    type: 'codeBlock',
    attrs: { language: 'js' },
    content: [t('const x = 1')],
  });
  assert.equal(proseMirrorToMarkdown(d), '```js\nconst x = 1\n```');
});

test('hard break and horizontal rule', () => {
  const d = doc(p(t('a'), { type: 'hardBreak' }, t('b')), { type: 'horizontalRule' });
  assert.equal(proseMirrorToMarkdown(d), 'a  \nb\n\n---');
});

test('an unknown node falls through to its text', () => {
  const d = doc({ type: 'mystery', content: [p(t('kept'))] });
  assert.equal(proseMirrorToMarkdown(d), 'kept');
});
