// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
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
