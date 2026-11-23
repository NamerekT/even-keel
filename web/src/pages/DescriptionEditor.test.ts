// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { DescriptionEditor } from './DescriptionEditor.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLElement
let coarse = false

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse'), addEventListener() {}, removeEventListener() {} }))
  // The Markdown field: the visual editor is not what these tests are about.
  localStorage.setItem('even-keel.description.look', 'markdown')
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  localStorage.clear()
  coarse = false
})

function Editor({ onText, onUpload }: { onText: (text: string) => void; onUpload: (file: File) => Promise<{ name: string; type: string; url: string }> }) {
  const [text, setText] = useState('')
  const write = (next: string) => {
    setText(next)
    onText(next)
  }
  return createElement(DescriptionEditor, { start: '', text, revision: 0, busy: false, failure: null, limit: 1000, onText: write, onUpload, onSave() {}, onClose() {} })
}

const hint = () => host.querySelector('.description__hint')!.textContent

it('attaches a file picked with the "+" as a dropped one: an upload mark, then the picture', async () => {
  const texts: string[] = []
  const onUpload = vi.fn(async (file: File) => ({ name: file.name, type: file.type, url: '/files/shot.png' }))
  await act(async () => root.render(createElement(Editor, { onText: (text) => texts.push(text), onUpload })))
  const input = host.querySelector<HTMLInputElement>('.description__foot input[type=file]')!
  const shot = new File(['x'], 'shot.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { configurable: true, value: [shot] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(onUpload).toHaveBeenCalledWith(shot)
  expect(texts.at(-1)).toContain('![shot.png](/files/shot.png)')
})

it('names the keys, Ctrl+V and dropping with a mouse, and only the buttons on a touch screen', async () => {
  await act(async () => root.render(createElement(Editor, { onText() {}, onUpload: vi.fn() })))
  expect(hint()).toBe(t.card.edit.describe.saveTipFiles)
  await act(async () => root.unmount())
  coarse = true
  root = createRoot(host)
  await act(async () => root.render(createElement(Editor, { onText() {}, onUpload: vi.fn() })))
  expect(hint()).toBe(t.card.edit.describe.saveTipTouch)
  expect(hint()).not.toMatch(/Ctrl|\bEsc\b|drop/i)
  await act(async () => host.querySelector<HTMLButtonElement>('.description__foot button.chat__attach')!.click())
  expect(host.querySelector('dialog.attach-sheet h2')!.textContent).toBe(t.card.edit.describe.attachTitle)
})
