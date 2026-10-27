import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { withBrief } from '../chain/relay.js'
import { adfToMarkdown, markdownToAdf, type AdfMark, type AdfNode } from './adf.js'

const doc = (...content: AdfNode[]): AdfNode => ({ type: 'doc', version: 1, content })
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })
const text = (value: string, ...marks: AdfMark[]): AdfNode => (marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks })

describe('adfToMarkdown', () => {
  const render = (markdown: string) => renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm], rehypePlugins: [rehypeRaw, rehypeSanitize], children: markdown,
  }))

  it.each([
    'git -C project merge --no-edit <your-branch>',
    '*stars* and _underscores_ and **bold** and ~~strike~~',
    '`literal code` and [label](target) and ![image](target)',
    String.raw`C:\project\file &copy; &#65; <b>text</b>`,
    'A trailing backslash \\',
    '# Heading', '- item', '+ item', '1. item', '2) item', '> quote',
    '---', '===', '~~~', '***', '[label]: target',
  ])('keeps literal text through card rendering and the ADF round trip: %s', (value) => {
    const adf = doc(p(text(value)))
    const markdown = adfToMarkdown(adf)
    const html = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    expect(render(markdown)).toBe(`<p>${html}</p>`)
    expect(markdownToAdf(markdown)).toEqual(adf)
  })

  it('escapes each line after a hard break without turning plain lines into blocks', () => {
    const adf = doc(p(text('First'), { type: 'hardBreak' }, text('# heading'), { type: 'hardBreak' }, text('1. item')))
    const markdown = adfToMarkdown(adf)
    expect(render(markdown)).toBe('<p>First<br/>\n# heading<br/>\n1. item</p>')
    expect(markdownToAdf(markdown)).toEqual(adf)
  })

  it('keeps real marks while escaping their literal content, leaving code unchanged', () => {
    const value = '<branch> & *literal* _name_'
    const adf = doc(
      p(text(value, { type: 'strong' }), text(' '), text(value, { type: 'code' })),
      { type: 'codeBlock', content: [text(value)] },
    )
    const markdown = adfToMarkdown(adf)
    expect(render(markdown)).toBe('<p><strong>&lt;branch&gt; &amp; *literal* _name_</strong> <code>&lt;branch&gt; &amp; *literal* _name_</code></p>\n<pre><code>&lt;branch&gt; &amp; *literal* _name_\n</code></pre>')
    expect(markdownToAdf(markdown)).toEqual(adf)
  })

  it('keeps an ordinary session brief readable', () => {
    const description = adfToMarkdown(doc(p(text('Run git -C project merge --no-edit <your-branch>. Then check the result.'))))
    expect(withBrief('ABC-1\n', { title: 'Merge the branch', description }, 'en')).toBe('ABC-1\n\nTask from the tracker: Merge the branch\n\nRun git -C project merge --no-edit \\<your-branch\\>. Then check the result.\n')
  })

  it.each<AdfMark>([
    { type: 'strong' }, { type: 'em' }, { type: 'strike' },
    { type: 'link', attrs: { href: 'https://example.com' } },
  ])('round trips literal delimiters inside a real $type mark', (mark) => {
    const value = '*single* **double** ~~strike~~ [label](target)'
    const adf = doc(p(text(value, mark)))
    expect(markdownToAdf(adfToMarkdown(adf))).toEqual(adf)
  })

  it('turns headings, marks and links into Markdown', () => {
    const adf = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
      p(text('Use '), text('npm test', { type: 'code' }), text(' and '), text('read', { type: 'strong' }), text(' the '), text('guide', { type: 'link', attrs: { href: 'https://example.com/guide' } }), text('.')),
      p(text('old', { type: 'strike' }), text(' '), text('new', { type: 'em' })),
    )
    expect(adfToMarkdown(adf)).toBe('## Plan\n\nUse `npm test` and **read** the [guide](https://example.com/guide).\n\n~~old~~ *new*')
  })

  it('nests lists, keeps the order start and the task list state', () => {
    const item = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content })
    const adf = doc(
      { type: 'bulletList', content: [item(p(text('one')), { type: 'orderedList', attrs: { order: 3 }, content: [item(p(text('three'))), item(p(text('four')))] }), item(p(text('two')))] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [text('done')] }, { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('open')] }] },
    )
    expect(adfToMarkdown(adf)).toBe('- one\n  3. three\n  4. four\n- two\n\n- [x] done\n- [ ] open')
  })

  it('fences code, quotes quotes and panels, draws rules and breaks lines', () => {
    const adf = doc(
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1\nconst b = 2')] },
      { type: 'blockquote', content: [p(text('quoted'), { type: 'hardBreak' }, text('second'))] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [p(text('note'))] },
      { type: 'rule' },
    )
    expect(adfToMarkdown(adf)).toBe('```ts\nconst a = 1\nconst b = 2\n```\n\n> quoted\\\n> second\n\n> note\n\n---')
  })

  it('writes mentions, emoji, cards, statuses and dates as text', () => {
    const adf = doc(p(
      { type: 'mention', attrs: { id: 'account-1', text: '@John Doe' } }, text(' '),
      { type: 'mention', attrs: { id: 'account-2' } }, text(' '),
      { type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } }, text(' '),
      { type: 'inlineCard', attrs: { url: 'https://example.com/card' } }, text(' '),
      { type: 'status', attrs: { text: 'IN REVIEW' } }, text(' '),
      { type: 'date', attrs: { timestamp: '1792972800000' } },
    ))
    expect(adfToMarkdown(adf)).toBe('@John Doe @account-2 😄 <https://example.com/card> [IN REVIEW] 2026-10-26')
  })

  it('turns media into links through the resolver, and into a mark without one', () => {
    const adf = doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'media-1', type: 'file', alt: 'screen.png' } }] }, { type: 'mediaGroup', content: [{ type: 'media', attrs: { id: 'media-2', type: 'file', alt: 'log.txt' } }] })
    expect(adfToMarkdown(adf, (media) => (media.alt === 'screen.png' ? { url: '/files/10001', image: true } : null))).toBe('![screen.png](/files/10001)\n\n(attachment: log.txt)')
  })

  it('renders a table with its first row as the header', () => {
    const cell = (type: string, value: string): AdfNode => ({ type, content: [p(text(value))] })
    const adf = doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Key'), cell('tableHeader', 'Value')] },
      { type: 'tableRow', content: [cell('tableCell', 'a|b'), cell('tableCell', '1')] },
    ] })
    expect(adfToMarkdown(adf)).toBe('| Key | Value |\n| --- | --- |\n| a\\|b | 1 |')
  })

  it('reads an empty or missing description as empty text and unknown nodes by their content', () => {
    expect(adfToMarkdown(null)).toBe('')
    expect(adfToMarkdown(doc())).toBe('')
    expect(adfToMarkdown(doc({ type: 'expand', attrs: { title: 'Details' }, content: [p(text('inside'))] }, { type: 'extension', attrs: {} }))).toBe('**Details**\n\ninside')
  })
})

describe('markdownToAdf', () => {
  it('builds paragraphs with marks, links and line breaks', () => {
    expect(markdownToAdf('Run `npm test`, **then** *read* ~~it~~ [here](https://example.com).\nNext line\n\nhttps://example.com/x')).toEqual(doc(
      p(
        text('Run '), text('npm test', { type: 'code' }), text(', '), text('then', { type: 'strong' }), text(' '), text('read', { type: 'em' }), text(' '), text('it', { type: 'strike' }), text(' '),
        text('here', { type: 'link', attrs: { href: 'https://example.com' } }), text('.'), { type: 'hardBreak' }, text('Next line'),
      ),
      p(text('https://example.com/x', { type: 'link', attrs: { href: 'https://example.com/x' } })),
    ))
  })

  it('builds headings, code blocks, quotes and rules', () => {
    expect(markdownToAdf('# Title\n\n```sh\nnpm test\n\nnpm run build\n```\n\n> quoted\n> more\n\n---')).toEqual(doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
      { type: 'codeBlock', attrs: { language: 'sh' }, content: [text('npm test\n\nnpm run build')] },
      { type: 'blockquote', content: [p(text('quoted'), { type: 'hardBreak' }, text('more'))] },
      { type: 'rule' },
    ))
  })

  it('builds numbered and nested lists', () => {
    const item = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content })
    expect(markdownToAdf('1. First\n2. Second\n   - inner\n- other')).toEqual(doc(
      { type: 'orderedList', attrs: { order: 1 }, content: [item(p(text('First'))), item(p(text('Second')), { type: 'bulletList', content: [item(p(text('inner')))] })] },
      { type: 'bulletList', content: [item(p(text('other')))] },
    ))
  })

  it('keeps escaped marks and unclosed ones as text, and an empty text as an empty document', () => {
    expect(markdownToAdf('a \\*b\\* and *c')).toEqual(doc(p(text('a *b* and *c'))))
    expect(markdownToAdf('  \n')).toEqual(doc())
  })

  it('comes back through adfToMarkdown as the same text', () => {
    const markdown = '## Question\n\nWhich one?\n\n1. **Keep** it\n2. Drop `it`\n\n> a quote\n\n```\ncode\n```'
    expect(adfToMarkdown(markdownToAdf(markdown))).toBe(markdown)
  })
})
