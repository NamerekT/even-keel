// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { cardMarkdown } from './CardText.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const state = {
  taskPrefixes: { own: 'ABC', other: 'DE_MO' },
  config: { feeds: { other: [{ id: 'f1', tracker: 'linear', key: 'ALIAS', prefix: 'EXT' }, { id: 'f2', tracker: 'builtin', key: 'FEED' }] } },
}

it('opens whole task numbers from every project and feed, including unlisted tasks', async () => {
  const open = vi.fn()
  const host = document.createElement('div')
  const root = createRoot(host)
  const markdown = cardMarkdown(state, open, [])
  try {
    await act(async () => root.render(markdown.render('See **ABC-1**, (EXT-999), DE_MO-2 and FEED-3.')))
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button.task-card__inline-ref')]
    expect(host.textContent).toBe('See ABC-1, (EXT-999), DE_MO-2 and FEED-3.')
    expect(buttons.map(button => button.textContent)).toEqual(['ABC-1', 'EXT-999', 'DE_MO-2', 'FEED-3'])
    for (const button of buttons) button.click()
    expect(open.mock.calls.flat()).toEqual(['ABC-1', 'EXT-999', 'DE_MO-2', 'FEED-3'])
  } finally {
    await act(async () => root.unmount())
  }
})

it('preserves code, existing links, addresses, branches, word boundaries and unknown prefixes', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const source = [
    '`ABC-1`',
    '```\nABC-2\n```',
    '[see ABC-3](https://example.com) and [see ABC-4][ref]',
    '[ref]: https://example.org',
    '<code>ABC-5</code> and <a href="https://example.net">see ABC-6</a>',
    'https://example.com/ABC-7 /browse/ABC-8 abc-9/work ABC-10/work',
    '/browse/key.ABC-18 /browse?ABC-19 ABC-20.md',
    'UTF-8 ISO-8601 GPT-5 ALIAS-11 xABC-12 ABC-13x яABC-14 ABC-15я',
    '<pre>ABC-21</pre>',
    '[ABC-16](tracker) and ABC-17.',
  ].join('\n\n')
  try {
    await act(async () => root.render(cardMarkdown(state, vi.fn(), []).render(source)))
    expect([...host.querySelectorAll('button.task-card__inline-ref')].map(button => button.textContent)).toEqual(['ABC-16', 'ABC-17'])
    expect([...host.querySelectorAll('a')].map(link => link.textContent)).toEqual(['see ABC-3', 'see ABC-4', 'see ABC-6', 'https://example.com/ABC-7'])
  } finally {
    await act(async () => root.unmount())
  }
})
