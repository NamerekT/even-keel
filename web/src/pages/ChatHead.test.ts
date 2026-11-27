// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatKey, ChatTitle } from './ChatHead.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
// A press opens the tip: happy-dom has no popovers.
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const render = (title: string | null, rename: (name: string) => Promise<string | null>) =>
  act(async () => root.render(createElement(ChatTitle, { title, rename })))

const shown = () => host.querySelector('.transcript__title')?.textContent ?? null

async function type(text: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('.transcript__title')!.click())
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

const press = (input: HTMLInputElement, key: string) => act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe("a project chat's title in the window head (BTN-1774)", () => {
  it('saves the typed name on Enter and shows it from then on', async () => {
    const rename = vi.fn(async (name: string) => name)
    await render('Slow build', rename)
    await press(await type('  Build speed '), 'Enter')
    expect(rename).toHaveBeenCalledWith('Build speed')
    expect(shown()).toBe('Build speed')
  })

  it('brings back the automatic title the service answers with for an empty name', async () => {
    const rename = vi.fn(async () => 'Slow build')
    await render('Build speed', rename)
    await act(async () => (await type('')).dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(rename).toHaveBeenCalledWith('')
    expect(shown()).toBe('Slow build')
  })

  it('sends nothing on Escape or an unchanged title, and goes back to the old title on a refusal', async () => {
    const rename = vi.fn(async (): Promise<string | null> => {
      throw new Error('refused')
    })
    await render('Slow build', rename)
    await press(await type('Build speed'), 'Escape')
    await press(await type('Slow build'), 'Enter')
    expect(rename).not.toHaveBeenCalled()
    await press(await type('Build speed'), 'Enter')
    expect(rename).toHaveBeenCalledOnce()
    expect(shown()).toBe('Slow build')
  })

  it('opens an untitled chat with an empty field', async () => {
    await render(null, vi.fn(async () => null))
    expect(shown()).not.toBe('')
    await act(async () => host.querySelector<HTMLButtonElement>('.transcript__title')!.click())
    expect(host.querySelector('input')!.value).toBe('')
  })
})

describe("a project chat's key in the window head (BTN-1774)", () => {
  it("copies the session's id on a press, and is plain text before the chat has a session", async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await act(async () => root.render(createElement(ChatKey, { label: 'Chat', sessionId: 'session-1' })))
    await act(async () => host.querySelector<HTMLButtonElement>('button.panel__key')!.click())
    expect(writeText).toHaveBeenCalledWith('session-1')
    await act(async () => root.render(createElement(ChatKey, { label: 'Chat', sessionId: '' })))
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('.panel__key')?.textContent).toBe('Chat')
  })
})
