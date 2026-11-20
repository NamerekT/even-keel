// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import type { ClipboardEntry } from './chatFiles.js'
import { AttachButton, FileStrip } from './ComposerFiles.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLElement
let coarse = false
const create = vi.fn((file: File) => `blob:${file.name}`)
const revoke = vi.fn()

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse'), addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  URL.createObjectURL = create
  URL.revokeObjectURL = revoke
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  coarse = false
  vi.clearAllMocks()
})

async function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

it('opens the file picker straight from the "+" with a mouse', async () => {
  const onAttach = vi.fn()
  await act(async () => root.render(createElement(AttachButton, { sending: false, onAttach })))
  expect(host.querySelectorAll('input[type=file]')).toHaveLength(1)
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  expect(input.multiple).toBe(true)
  expect(input.hasAttribute('accept')).toBe(false)
  expect(host.querySelector('dialog')).toBeNull()
})

it('opens Camera, Photos and Files from the "+" on a touch screen and closes once files are picked', async () => {
  coarse = true
  const onAttach = vi.fn()
  await act(async () => root.render(createElement(AttachButton, { sending: false, onAttach })))
  expect(host.querySelector('input[type=file]')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__attach')!.click())
  const sheet = host.querySelector('dialog.attach-sheet')!
  const text = t.session.chat.attachMenu
  expect([...sheet.querySelectorAll('.attach-sheet__tile')].map((tile) => tile.textContent)).toEqual([text.camera, text.photos, text.files])
  const input = (at: number) => sheet.querySelectorAll<HTMLInputElement>('input[type=file]')[at]!
  const [camera, photos, files] = [input(0), input(1), input(2)]
  expect([camera.accept, camera.getAttribute('capture'), camera.multiple]).toEqual(['image/*', 'environment', false])
  expect([photos.accept, photos.hasAttribute('capture'), photos.multiple]).toEqual(['image/*,video/*', false, true])
  expect([files.hasAttribute('accept'), files.multiple]).toEqual([false, true])
  const shot = new File(['x'], 'shot.jpg', { type: 'image/jpeg' })
  await pick(photos, [shot])
  expect(onAttach).toHaveBeenCalledWith([shot])
  expect(host.querySelector('dialog')).toBeNull()
})

async function openSheet(onAttach = vi.fn()) {
  coarse = true
  await act(async () => root.render(createElement(AttachButton, { sending: false, onAttach })))
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__attach')!.click())
  return host.querySelector('dialog.attach-sheet')!
}

function clipboardWith(read: () => Promise<ClipboardEntry[]>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read } })
}

const paste = (sheet: Element) => sheet.querySelector<HTMLButtonElement>('button.attach-sheet__tile')

it('offers no Paste tile where the browser cannot read the clipboard', async () => {
  const sheet = await openSheet()
  expect(paste(sheet)).toBeNull()
  expect(sheet.querySelectorAll('.attach-sheet__tile')).toHaveLength(3)
})

it('attaches the picture of the clipboard from the Paste tile and closes the sheet', async () => {
  const png = new Blob(['png'], { type: 'image/png' })
  clipboardWith(async () => [{ types: ['image/png'], getType: async () => png }])
  const onAttach = vi.fn()
  const sheet = await openSheet(onAttach)
  expect(paste(sheet)!.textContent).toBe(t.session.chat.attachMenu.paste)
  await act(async () => paste(sheet)!.click())
  const [files] = onAttach.mock.calls[0]! as [File[]]
  expect(files.map((file) => file.type)).toEqual(['image/png'])
  expect(files[0]!.name).toMatch(/^paste-\d{8}-\d{6}\.png$/)
  expect(host.querySelector('dialog')).toBeNull()
})

it('says so in the sheet when the clipboard holds no picture or the browser refuses, and keeps the sheet open', async () => {
  const onAttach = vi.fn()
  const read = vi.fn(async (): Promise<ClipboardEntry[]> => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }])
  clipboardWith(read)
  const sheet = await openSheet(onAttach)
  await act(async () => paste(sheet)!.click())
  const note = () => sheet.querySelector('.attach-sheet__note')?.textContent
  expect(note()).toBe(t.session.chat.attachMenu.pasteEmpty)
  read.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
  await act(async () => paste(sheet)!.click())
  expect(note()).toBe(t.session.chat.attachMenu.pasteDenied)
  expect(onAttach).not.toHaveBeenCalled()
  expect(host.querySelector('dialog')).not.toBeNull()
})

it('shows pictures as thumbnails, other files by extension, and frees the URL of a removed picture', async () => {
  const shot = new File(['x'], 'shot.png', { type: 'image/png' })
  const doc = new File(['x'], 'report.pdf', { type: 'application/pdf' })
  const onRemove = vi.fn()
  await act(async () => root.render(createElement(FileStrip, { files: [shot, doc], sending: false, onRemove })))
  expect(host.querySelector<HTMLImageElement>('.chat__tile--image img')!.getAttribute('src')).toBe('blob:shot.png')
  expect(host.querySelector('.chat__tile--file')!.textContent).toBe('PDFreport')
  expect(create).toHaveBeenCalledTimes(1)
  await act(async () => root.render(createElement(FileStrip, { files: [doc], sending: false, onRemove })))
  expect(revoke).toHaveBeenCalledWith('blob:shot.png')
  expect(host.querySelector('.chat__tile--image')).toBeNull()
})

it('opens a thumbnail in the viewer from its own object URL, pages through pictures and videos only, and the cross opens nothing', async () => {
  const shot = new File(['x'], 'shot.png', { type: 'image/png' })
  const doc = new File(['x'], 'report.pdf', { type: 'application/pdf' })
  const clip = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
  const onRemove = vi.fn()
  await act(async () => root.render(createElement(FileStrip, { files: [shot, doc, clip], sending: false, onRemove })))
  expect(host.querySelector('.chat__tile--file button.chat__view')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__tile--image .chat__unfile')!.click())
  expect(onRemove).toHaveBeenCalledWith(0)
  expect(host.querySelector('dialog.viewer')).toBeNull()

  const view = host.querySelector<HTMLButtonElement>('.chat__tile--video button.chat__view')!
  expect(view.getAttribute('aria-label')).toBe(t.session.chat.viewFile('clip.mp4'))
  await act(async () => view.click())
  const viewer = host.querySelector('dialog.viewer')!
  expect(viewer.querySelector('video')!.getAttribute('src')).toBe('blob:clip.mp4')
  expect(viewer.querySelector('.viewer__counter')!.textContent).toBe('2 / 2')
  await act(async () => viewer.querySelector<HTMLButtonElement>('.viewer__nav--prev')!.click())
  expect(viewer.querySelector('img')!.getAttribute('src')).toBe('blob:shot.png')
  await act(async () => viewer.querySelector<HTMLButtonElement>('.viewer__close')!.click())
  expect(host.querySelector('dialog.viewer')).toBeNull()
  expect(create).toHaveBeenCalledTimes(2)
})
