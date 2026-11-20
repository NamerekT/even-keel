// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { LONG_PRESS_MS, MessageMenu } from './MessageMenu.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLDivElement
const writeText = vi.fn(async () => {})

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  writeText.mockClear()
  vi.useRealTimers()
})

function mount(onAccept?: () => void) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(createElement(MessageMenu, { text: 'The answer.', onAccept, children: createElement('p', null, 'The answer.') })))
  return host.querySelector<HTMLElement>('.message-menu')!
}

const items = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((item) => item.textContent)

function rightClick(target: HTMLElement) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 })
  act(() => void target.dispatchEvent(event))
  return event
}

function pointer(target: HTMLElement, type: string, x = 40, y = 30) {
  act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })))
}

it('opens on a right click with "Accept as answer" and "Copy text", instead of the browser menu', () => {
  const accept = vi.fn()
  const message = mount(accept)
  expect(items()).toEqual([])
  const event = rightClick(message.querySelector('p')!)
  expect(event.defaultPrevented).toBe(true)
  expect(items()).toEqual([t.session.accept, t.session.chat.message.copy])
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(accept).toHaveBeenCalledOnce()
  expect(items()).toEqual([])
})

it('copies the whole message', () => {
  const message = mount()
  rightClick(message)
  expect(items()).toEqual([t.session.chat.message.copy])
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(writeText).toHaveBeenCalledWith('The answer.')
})

it('closes on Escape and on a press elsewhere', () => {
  const message = mount(() => {})
  rightClick(message)
  act(() => void host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(items()).toEqual([])
  rightClick(message)
  act(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  expect(items()).toEqual([])
})

it('opens on a long press of a finger, not on a press that moves or lifts early', () => {
  vi.useFakeTimers()
  const message = mount(() => {})
  pointer(message, 'pointerdown')
  act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 50))
  pointer(message, 'pointerup')
  act(() => vi.advanceTimersByTime(200))
  expect(items()).toEqual([])
  pointer(message, 'pointerdown')
  pointer(message, 'pointermove', 40, 60)
  act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
  expect(items()).toEqual([])
  pointer(message, 'pointerdown')
  act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
  expect(items()).toHaveLength(2)
})

it('leaves the browser menu to a right click on text selected in the message', () => {
  const message = mount(() => {})
  const range = document.createRange()
  range.selectNodeContents(message.querySelector('p')!)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  const event = rightClick(message.querySelector('p')!)
  expect(event.defaultPrevented).toBe(false)
  expect(items()).toEqual([])
  document.getSelection()!.removeAllRanges()
})

it('without a clipboard or an answer to accept it leaves the browser menu', () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  const message = mount()
  expect(rightClick(message).defaultPrevented).toBe(false)
  expect(items()).toEqual([])
})
