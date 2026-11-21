// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import type { Media } from './MediaViewer.js'
import { InboxThumb, ThumbStack } from './Thumbs.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const items: Media[] = Array.from({ length: 12 }, (_, index) => ({ kind: 'image', name: `shot-${index}.png`, url: `/shots/${index}.png` }))

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
})

async function stack(places: number[], onOpen: (place: number) => void = () => {}) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(ThumbStack, { places, items, onOpen })))
  return host
}

const layers = (host: HTMLElement) => [...host.querySelectorAll<HTMLImageElement>('.thumb-stack__layer img')].map((img) => img.getAttribute('src'))

async function fail(host: HTMLElement, src: string) {
  const img = host.querySelector<HTMLImageElement>(`img[src="${src}"]`)!
  await act(async () => img.dispatchEvent(new Event('error')))
}

describe('the stack of a folded group', () => {
  it('draws the first picture on top and at most two under it, however many there are', async () => {
    const host = await stack([3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(layers(host)).toEqual(['/shots/3.png', '/shots/4.png', '/shots/5.png'])
  })

  it('opens the viewer on the first picture and tells the screen reader how many there are, with no count drawn', async () => {
    const onOpen = vi.fn()
    const host = await stack([2, 5, 7, 9], onOpen)
    const button = host.querySelector<HTMLButtonElement>('.thumb-stack')!
    expect(button.getAttribute('aria-label')).toBe(t.session.chat.openPictures('shot-2.png', 4))
    expect(button.textContent).toBe('')
    await act(async () => button.click())
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('draws two layers for two pictures', async () => {
    expect(layers(await stack([0, 1]))).toEqual(['/shots/0.png', '/shots/1.png'])
  })

  it('is a plain thumbnail for one picture and nothing for none', async () => {
    const one = await stack([4])
    expect(one.querySelector('.thumb-stack')).toBeNull()
    expect(one.querySelectorAll('.thumb img')).toHaveLength(1)
    await act(async () => root.unmount())
    expect((await stack([])).innerHTML).toBe('')
  })

  it('leaves out a picture that does not load and takes the next one in', async () => {
    const host = await stack([0, 1, 2, 3, 4])
    await fail(host, '/shots/0.png')
    expect(layers(host)).toEqual(['/shots/1.png', '/shots/2.png', '/shots/3.png'])
    expect(host.querySelector('.thumb-stack')!.getAttribute('aria-label')).toBe(t.session.chat.openPictures('shot-1.png', 4))
  })

  it('opens on the first picture that loaded', async () => {
    const onOpen = vi.fn()
    const host = await stack([0, 1, 2], onOpen)
    await fail(host, '/shots/0.png')
    await act(async () => host.querySelector<HTMLButtonElement>('.thumb-stack')!.click())
    expect(onOpen).toHaveBeenCalledWith(1)
  })

  it('turns into one thumbnail when one picture is left, and goes when none is', async () => {
    const host = await stack([0, 1])
    await fail(host, '/shots/0.png')
    expect(host.querySelector('.thumb-stack')).toBeNull()
    expect(host.querySelectorAll('.thumb img')).toHaveLength(1)
    await fail(host, '/shots/1.png')
    expect(host.innerHTML).toBe('')
  })
})

async function inbox(item: Media) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(InboxThumb, { item, onOpen: () => {} })))
  return host
}

describe('a picture the user sent', () => {
  it('shows at once from the chosen file while the transcript has not got the reply', async () => {
    const host = await inbox({ kind: 'image', name: 'order.png', url: 'blob:order' })
    expect(host.querySelector('.thumb img')?.getAttribute('src')).toBe('blob:order')
    expect(host.textContent).not.toContain('📎')
  })

  it('is a file chip while the service has not given a picture the browser does not hold', async () => {
    const host = await inbox({ kind: 'image', name: 'order.png', url: '/files/order.png', inbox: true })
    expect(host.textContent).toContain('📎 order.png')
    await load(host, '/files/order.png')
    expect(shown(host)).toEqual(['/files/order.png'])
    expect(host.textContent).not.toContain('📎')
  })


  it('keeps the picture on screen when its address turns, until the next one has loaded (BTN-1390)', async () => {
    const chosen: Media = { kind: 'image', name: 'order.png', url: 'blob:order' }
    const host = await inbox(chosen)
    await load(host, 'blob:order')
    const observer = new MutationObserver(() => {})
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true })
    await act(async () => root.render(createElement(InboxThumb, { item: { ...chosen, url: '/files/order.png', inbox: true }, onOpen: () => {} })))
    expect(shown(host)).toEqual(['blob:order'])
    expect(host.querySelectorAll('img')).toHaveLength(2)
    await load(host, '/files/order.png')
    expect(shown(host)).toEqual(['/files/order.png'])
    const records = observer.takeRecords()
    observer.disconnect()
    expect(records.some((record) => record.oldValue?.includes('chat__file') || [...record.addedNodes].some((node) => node.textContent?.includes('📎')))).toBe(false)
  })

  it('keeps the loaded picture for good when its next address fails', async () => {
    const service: Media = { kind: 'image', name: 'order.png', url: '/files/order.png', inbox: true }
    const host = await inbox(service)
    await load(host, '/files/order.png')
    await act(async () => root.render(createElement(InboxThumb, { item: { kind: 'image', name: 'order.png', url: '/read/order.png' }, onOpen: () => {} })))
    await fail(host, '/read/order.png')
    expect(shown(host)).toEqual(['/files/order.png'])
    expect(host.querySelectorAll('img')).toHaveLength(1)
  })

  it('is a file chip when a picture the browser held does not load and nothing was on screen', async () => {
    const host = await inbox({ kind: 'image', name: 'order.png', url: 'blob:order' })
    await fail(host, 'blob:order')
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('📎 order.png')
  })
})

/** The addresses of the pictures a sent one's button draws, leaving out the next one loading unseen. */
const shown = (host: HTMLElement) => [...host.querySelectorAll('.thumb img:not(.thumb__next)')].map((img) => img.getAttribute('src'))

async function load(host: HTMLElement, src: string) {
  await act(async () => host.querySelector(`img[src="${src}"]`)!.dispatchEvent(new Event('load')))
}
