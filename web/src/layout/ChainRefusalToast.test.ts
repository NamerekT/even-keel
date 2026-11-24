// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chainRefusal } from '../chainRefusal.js'
import { t } from '../i18n/index.js'
import { ChainRefusalToast } from './ChainRefusalToast.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root
let host: HTMLElement

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  chainRefusal.set(null)
})

const refuse = () =>
  act(async () => chainRefusal.set({ task: 'ABC-7', notice: { code: 'chain.currentFirst', params: { task: 'ABC-1' } } }))

describe('ChainRefusalToast', () => {
  it('names the dropped task, why the server refused and what to do', async () => {
    await act(async () => root.render(createElement(ChainRefusalToast)))
    expect(host.querySelector('.toast')).toBeNull()
    await refuse()
    const toast = host.querySelector('.toast')
    expect(toast?.querySelector('.toast__title')?.textContent).toBe(t.chain.dropRefused('ABC-7'))
    const body = toast?.querySelector('.toast__body')?.textContent ?? ''
    expect(body).toContain('ABC-1')
    expect(body).toContain('drop the task below it')
  })

  it('goes on its close button', async () => {
    await act(async () => root.render(createElement(ChainRefusalToast)))
    await refuse()
    const close = [...host.querySelectorAll('button')].find((button) => button.textContent === t.chain.dropRefusedClose)
    await act(async () => close?.click())
    expect(chainRefusal.get()).toBeNull()
  })
})
