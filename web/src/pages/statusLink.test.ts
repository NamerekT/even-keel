import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TrackerView } from '../../../src/tracker/health.js'
import { t } from '../i18n/index.js'
import { LinkState, Reader } from './statusLink.js'

vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null }) }))
// The tip as a `<template>` beside what it explains, so the test tells what is seen from what is pointed at.
vi.mock('../ui/Tipped.js', async () => {
  const { createElement: element } = await import('react')
  return { Tipped: ({ tip, children }: { tip: ReactNode; children: ReactNode }) => element('span', { className: 'tipped' }, children, element('template', null, tip)) }
})

const NOW = new Date('2026-11-20T12:00:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()

const tracker = (health: TrackerView['health']): TrackerView =>
  ({ name: 'huly-example', kind: 'huly', title: 'example', projects: ['ABC'], ready: true, health, readAt: {} }) as TrackerView

/** The text a person sees at once: the markup without the tips. */
const visible = (html: string) => html.replace(/<template>[\s\S]*?<\/template>/g, '')

describe('a connection on /status glues no facts (BTN-1382)', () => {
  it('shows the word alone and puts when it was polled into the tip', () => {
    const html = renderToStaticMarkup(createElement(LinkState, { tracker: tracker({ state: 'live', lastOkAt: ago(0), error: null }), now: NOW, open: null }))
    expect(html).not.toContain('·')
    expect(visible(html)).toContain(t.system.live)
    expect(visible(html)).not.toContain(t.statusPage.polled(''))
    expect(html).toContain(t.statusPage.polled(''))
  })

  it('puts the last answer of a lost one into the tip', () => {
    const html = renderToStaticMarkup(createElement(LinkState, { tracker: tracker({ state: 'down', lastOkAt: ago(12), error: 'refused' }), now: NOW, open: null }))
    expect(html).not.toContain('·')
    expect(visible(html)).toContain(t.system.lost)
    expect(visible(html)).not.toContain(t.statusPage.lastAnswer(''))
  })

  it('has no tip when there is nothing to add', () => {
    const html = renderToStaticMarkup(createElement(LinkState, { tracker: tracker({ state: 'off', lastOkAt: null, error: null }), now: NOW, open: null }))
    expect(html).not.toContain('tipped')
  })
})

describe('a reader on /status (BTN-1382)', () => {
  it('names a feed by its key and its project in the tip', () => {
    const html = renderToStaticMarkup(createElement(Reader, { name: 'WEB', about: t.statusPage.feedOf('ABC'), stale: false, read: null, now: NOW }))
    expect(visible(html)).toContain('WEB')
    expect(visible(html)).not.toContain('ABC')
    expect(html).toContain(t.statusPage.feedOf('ABC'))
    expect(html).not.toMatch(/[·—]/)
  })

  it('marks a stale one and puts when it was read into the tip, a line each', () => {
    const html = renderToStaticMarkup(createElement(Reader, { name: 'OPS', about: null, stale: true, read: ago(12), now: NOW }))
    expect(html).toContain('status-reader--stale')
    expect(html).not.toContain('·')
    expect(visible(html)).not.toContain(t.statusPage.readAgo(''))
    expect(html.match(/status-reader__line/g)).toHaveLength(2)
  })

  it('is a bare tag when fresh and no feed', () => {
    const html = renderToStaticMarkup(createElement(Reader, { name: 'DEMO', about: null, stale: false, read: null, now: NOW }))
    expect(html).toBe('<li class="tag status-reader">DEMO</li>')
  })
})
