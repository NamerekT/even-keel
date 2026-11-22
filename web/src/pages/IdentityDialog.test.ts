// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { IdentityButton, type IdentityMachine } from './IdentityDialog.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const live = vi.hoisted(() => ({
  state: { git: { version: '2.47.1', name: 'John Doe', email: 'john@example.com' } } as Pick<EvenKeelState, 'git'>,
  command: vi.fn(async (_name: string, _body?: Record<string, unknown>) => {}),
}))
vi.mock('../live/context.js', () => ({ useLive: () => live }))

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  live.command.mockClear()
})

async function open(onSaved = () => {}, machine?: IdentityMachine) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(IdentityButton, { className: 'button', onSaved, ...(machine !== undefined && { machine }) })))
  await act(async () => host.querySelector('button')!.click())
  return document.querySelector('dialog')!
}

describe('the Name and e-mail for commits dialog (BTN-1104)', () => {
  it('reads git again when it opens', async () => {
    await open()
    expect(live.command).toHaveBeenCalledWith('git/check')
  })

  it('saves the same name and e-mail a stale view still shows, since a refusal said git has none', async () => {
    const onSaved = vi.fn()
    const dialog = await open(onSaved)
    const save = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(save.textContent).toBe(t.setup.git.save)
    expect(save.disabled).toBe(false)
    await act(async () => save.click())
    expect(live.command).toHaveBeenCalledWith('git/identity', { name: 'John Doe', email: 'john@example.com' })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it("fills a machine's dialog with the hub's name and e-mail where the machine has none and saves them there (BTN-1503)", async () => {
    const onSaved = vi.fn()
    const dialog = await open(onSaved, { id: 'srv', name: 'Home server' })
    expect(live.command).not.toHaveBeenCalledWith('git/check')
    expect(dialog.querySelector<HTMLInputElement>('#identity-dialog-name')!.value).toBe('John Doe')
    expect(dialog.querySelector<HTMLInputElement>('#identity-dialog-email')!.value).toBe('john@example.com')
    expect(dialog.textContent).toContain(t.setup.git.identityLeadMachine('Home server'))
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
    expect(live.command).toHaveBeenCalledWith('machines/gitIdentity', { machine: 'srv', name: 'John Doe', email: 'john@example.com' })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it("keeps a machine's own name and e-mail, and Save off until one is changed", async () => {
    const dialog = await open(() => {}, { id: 'srv', name: 'Home server', gitName: 'Jane Doe', gitEmail: 'jane@example.com' })
    expect(dialog.querySelector<HTMLInputElement>('#identity-dialog-name')!.value).toBe('Jane Doe')
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  })

  it('keeps Save off while a field is blank', async () => {
    const dialog = await open()
    const email = dialog.querySelector<HTMLInputElement>('#identity-dialog-email')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(email, '')
      email.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  })
})
