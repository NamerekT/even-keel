// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { CodeBlock, COPIED_MS } from './CodeBlock.js'
import sheet from './codeBlock.css?raw'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

let root: Root
let host: HTMLDivElement
const writeText = vi.fn(() => Promise.resolve())

async function show() {
  await act(async () => root.render(createElement(CodeBlock, null, createElement('code', null, 'npm run build\nnpm start\n'))))
}

const button = () => host.querySelector<HTMLButtonElement>('.ui-code__button')!
const press = () => act(async () => button().click())
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms))
const copied = () => host.querySelector('.ui-code')!.classList.contains('ui-code--copied')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  writeText.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

describe('CodeBlock', () => {
  it('copies the block text without the button and the trailing line break', async () => {
    await show()
    expect(button().getAttribute('aria-label')).toBe(t.common.copyCode)
    await press()
    expect(writeText).toHaveBeenCalledWith('npm run build\nnpm start')
    expect(copied()).toBe(true)
    expect(button().getAttribute('aria-label')).toBe(t.common.commandCopied)
  })

  it('keeps the check for 10 s, and a press on the check copies again and starts the 10 s anew', async () => {
    expect(COPIED_MS).toBe(10_000)
    await show()
    await press()
    await wait(6000)
    expect(copied()).toBe(true)
    await press()
    expect(writeText).toHaveBeenCalledTimes(2)
    await wait(6000)
    expect(copied()).toBe(true)
    await wait(4000)
    expect(copied()).toBe(false)
    expect(button().getAttribute('aria-label')).toBe(t.common.copyCode)
  })

  it('has no button without the clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    await show()
    expect(host.querySelector('.ui-code__button')).toBeNull()
    expect(host.querySelector('pre')?.textContent).toBe('npm run build\nnpm start\n')
  })
})

describe('codeBlock.css', () => {
  const hoverOnly = /@media \(hover: hover\) \{([\s\S]*?)\n\}/.exec(sheet)?.[1] ?? ''
  const outside = sheet.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/, '')

  it('hides the button only where the pointer hovers, until the block is hovered, focused from the keyboard or copied', () => {
    expect(hoverOnly).toMatch(/\.ui-code__copy \{[^}]*opacity: 0;/)
    expect(hoverOnly).toMatch(/\.ui-code:hover \.ui-code__copy,\s*\.ui-code__copy:has\(:focus-visible\),\s*\.ui-code--copied \.ui-code__copy \{[^}]*opacity: 1;/)
  })

  it('shows the button on a touch screen: nothing outside the hover query hides it', () => {
    expect(outside).not.toMatch(/opacity: 0/)
  })

  it('fades through the motion token', () => {
    expect(sheet).toMatch(/transition: opacity var\(--motion-fast\)/)
  })
})
