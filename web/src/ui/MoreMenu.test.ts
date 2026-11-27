// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MoreMenu } from './MoreMenu.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLElement
let feed: HTMLElement

beforeEach(async () => {
  host = document.body.appendChild(document.createElement('div'))
  feed = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(createElement(MoreMenu, { items: [{ label: 'Archive', pick: () => {} }], label: 'More', quiet: true })))
  await act(async () => host.querySelector<HTMLButtonElement>('.more-menu__quiet')!.click())
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
})

const scroll = async (target: EventTarget) => act(async () => void target.dispatchEvent(new Event('scroll')))
const items = () => host.querySelectorAll('.more-menu__item').length

it("stays open while a box beside it scrolls, as a working chat's feed does under its window's head (BTN-1775)", async () => {
  expect(items()).toBe(1)
  await scroll(feed)
  expect(items()).toBe(1)
})

it('closes when a box around its button scrolls, which moves the button away from it', async () => {
  await scroll(document.body)
  expect(items()).toBe(0)
})

it('closes when the page scrolls', async () => {
  await scroll(document)
  expect(items()).toBe(0)
})
