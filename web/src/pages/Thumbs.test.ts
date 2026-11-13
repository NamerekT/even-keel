// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import type { Media } from './MediaViewer.js'
import { ThumbStack } from './Thumbs.js'

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
