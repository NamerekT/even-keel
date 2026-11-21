// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaViewer, type Media } from './MediaViewer.js'

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
