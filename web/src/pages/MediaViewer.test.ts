// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaViewer, splitName, type Media } from './MediaViewer.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
})

async function view(host: HTMLElement, items: Media[], index = 0) {
  await act(async () => root.render(createElement(MediaViewer, { items, index, onIndex: () => {}, onClose: () => {} })))
}

const shown = (host: HTMLElement) => [...host.querySelectorAll<HTMLImageElement>('.viewer img:not(.viewer__next)')].map((img) => img.getAttribute('src'))
const load = (host: HTMLElement, src: string) => act(async () => host.querySelector(`img[src="${src}"]`)!.dispatchEvent(new Event('load')))

describe('the viewer', () => {
  it('keeps a picture on screen when its address turns, until the next one has loaded (BTN-1425)', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const sent: Media = { kind: 'image', name: 'order.png', url: '/files/order.png', inbox: true }
    await view(host, [sent])
    await load(host, '/files/order.png')
    await view(host, [{ kind: 'image', name: 'order.png', url: '/images/read/0' }])
    expect(shown(host)).toEqual(['/files/order.png'])
    expect(host.querySelector('img.viewer__next')?.getAttribute('src')).toBe('/images/read/0')
    await load(host, '/images/read/0')
    expect(shown(host)).toEqual(['/images/read/0'])
    expect(host.querySelectorAll('.viewer img')).toHaveLength(1)
  })

  it('shows a neighbour at once, without the last picture behind it', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const items: Media[] = [{ kind: 'image', name: 'a.png', url: '/a.png' }, { kind: 'image', name: 'b.png', url: '/b.png' }]
    await view(host, items)
    await load(host, '/a.png')
    await view(host, items, 1)
    expect(shown(host)).toEqual(['/b.png'])
  })
})

describe('the viewer bar (BTN-1706)', () => {
  const three: Media[] = ['a.png', 'b.png', 'c.mp4'].map((name) => ({ kind: name.endsWith('.mp4') ? 'video' : 'image', name, url: `/${name}` }))
  const pill = (host: HTMLElement) => host.querySelector('.viewer__pill')
  const arrows = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.viewer__pill button')].map((button) => button.disabled)

  it('has no pill for a single file, only the name and the open button', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await view(host, [three[0]!])
    expect(pill(host)).toBeNull()
    expect(host.querySelector('.viewer__name')?.textContent).toBe('a.png')
    expect(host.querySelector<HTMLAnchorElement>('a.viewer__open')?.getAttribute('href')).toBe('/a.png')
    expect(host.querySelectorAll('.viewer__nav')).toHaveLength(0)
  })

  it('keeps both arrows in the pill, the first one off on the first file', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await view(host, three)
    expect(pill(host)?.querySelector('.viewer__counter')?.textContent).toBe('1 / 3')
    expect(arrows(host)).toEqual([true, false])
  })

  it('turns the last arrow off on the last file', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await view(host, three, 2)
    expect(pill(host)?.querySelector('.viewer__counter')?.textContent).toBe('3 / 3')
    expect(arrows(host)).toEqual([false, true])
  })

  it('pages by the arrows of the pill', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const onIndex = vi.fn()
    await act(async () => root.render(createElement(MediaViewer, { items: three, index: 1, onIndex, onClose: () => {} })))
    const [back, on] = host.querySelectorAll<HTMLButtonElement>('.viewer__pill button')
    await act(async () => back!.click())
    await act(async () => on!.click())
    expect(onIndex.mock.calls).toEqual([[0], [2]])
  })

  it('keeps the extension whole and the full name in the tip', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const name = 'phone/2-composer-five-lines-while-scrolled-up.png'
    await view(host, [{ kind: 'image', name, url: '/long.png' }])
    expect(host.querySelector('.viewer__name')?.getAttribute('title')).toBe(name)
    expect(host.querySelector('.viewer__name-stem')?.textContent).toBe('phone/2-composer-five-lines-while-scrolled-up')
    expect(host.querySelector('.viewer__name-ext')?.textContent).toBe('.png')
  })
})

describe('splitName', () => {
  it('splits the extension after the last folder only', () => {
    expect(splitName('a/b.c/readme')).toEqual(['a/b.c/readme', ''])
    expect(splitName('shots/.env')).toEqual(['shots/.env', ''])
    expect(splitName('clip.final.mp4')).toEqual(['clip.final', '.mp4'])
  })
})
