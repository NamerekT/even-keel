// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountEntry } from '../../../src/account/model.js'
import type { EvenKeelState, MachineSignIn } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import type { FolderWay } from '../machineSignIn.js'
import { FolderSignIn } from './MachineFolderSignIn.js'
import { MachineLoginDialog } from './MachineSignIns.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const live = vi.hoisted(() => ({
  state: null as unknown as EvenKeelState,
  command: vi.fn(async (_name: string, _body?: Record<string, unknown>) => {}),
}))
vi.mock('../live/context.js', () => ({ useLive: () => live }))

const MACHINE = { id: 'machine-1', name: 'Example laptop', online: true }

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  live.command.mockClear()
})

async function render(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(element))
  return host
}

async function row(way: FolderWay, folder = 'example-api') {
  const send = vi.fn(async (_name: string, _body?: Record<string, unknown>) => true)
  const host = await render(createElement(FolderSignIn, { machine: MACHINE, agent: 'codex', folder, way, busy: false, noCli: null, send, menu: true }))
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) => each.textContent?.includes(label))
  return { host, send, button }
}

describe("a machine's signed-out folder's sign-in (BTN-1585)", () => {
  it("gives a key's folder no browser sign-in: it says the folder runs on a key", async () => {
    const { host, button } = await row('key')
    expect(button(t.account.login)).toBeUndefined()
    expect(host.textContent).toContain(t.machinePanel.view.keyFolder)
  })

  it("signs a subscription's folder in on the machine", async () => {
    const { send, button } = await row('subscription', 'john.doe@example.com')
    await act(async () => button(t.account.login)!.click())
    expect(send).toHaveBeenCalledWith('machines/login', { machine: 'machine-1', agent: 'codex', account: 'john.doe@example.com' })
  })

  it('asks the way of a folder that tells none before any sign-in; a key there opens the key window, which can remove the folder', async () => {
    const { send, button } = await row('unknown', 'spare')
    await act(async () => button(t.account.login)!.click())
    expect(send).not.toHaveBeenCalled()
    expect(document.querySelector('dialog')?.textContent).toContain(t.machinePanel.view.wayTitle('spare', 'Example laptop'))
    await act(async () => button(t.machinePanel.view.wayKey)!.click())
    expect(document.body.textContent).toContain(t.machinePanel.view.keyFolderTitle('spare', 'Example laptop'))
    await act(async () => button(t.machinePanel.view.keyRemove)!.click())
    expect(document.body.textContent).toContain(t.account.removeKeyNow)
    expect(send).not.toHaveBeenCalled()
  })

  it("enters a key into a key's folder from its row (BTN-1684)", async () => {
    const { button } = await row('key')
    await act(async () => button(t.machinePanel.view.keyEnter)!.click())
    const input = document.querySelector<HTMLInputElement>('dialog input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sk-example')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button(t.machinePanel.view.keyRemove)).toBeUndefined()
    await act(async () => button(t.machinePanel.view.keySave)!.click())
    expect(live.command).toHaveBeenCalledWith('machines/key', { machine: 'machine-1', agent: 'codex', key: 'sk-example', name: '', folder: 'example-api' })
  })

  it("the way dialog's subscription tile starts the sign-in", async () => {
    const { send, button } = await row('unknown', 'spare')
    await act(async () => button(t.account.login)!.click())
    await act(async () => button(t.account.access.chatgpt)!.click())
    expect(send).toHaveBeenCalledWith('machines/login', { machine: 'machine-1', agent: 'codex', account: 'spare' })
  })
})

describe("the window of a sign-in on a machine (BTN-1585)", () => {
  const login = (target: string | null): MachineSignIn['login'] => ({
    agent: 'codex', target, startedAt: '2026-11-25T10:00:00.000Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false,
  })
  const machine = (target: string | null, active?: string): MachineSignIn => ({
    machine: 'machine-1', name: 'Example laptop', online: true, missing: [], login: login(target), ...(active !== undefined && { active }),
    accounts: [{ key: 'work', agent: 'codex', email: 'john.doe@example.com', signedIn: false }],
  })
  const show = async (signIn: MachineSignIn, hub: AccountEntry[] = []) => {
    live.state = { machineSignIns: [signIn], account: { accounts: hub } } as unknown as EvenKeelState
    await render(createElement(MachineLoginDialog))
    return document.querySelector('dialog')!.textContent!
  }

  it('names the agent, the provider, the folder and its e-mail, and that the chain there takes the account', async () => {
    const text = await show(machine('work', 'work'))
    expect(text).toContain(t.account.machineLogin('Codex', 'Example laptop'))
    expect(text).toContain(t.account.access.chatgpt)
    expect(text).toContain('work')
    expect(text).toContain('john.doe@example.com')
    expect(text).toContain(t.account.machineLoginUsed('Example laptop'))
  })

  it('says a new account when the sign-in has no folder, and that no task takes it yet', async () => {
    const text = await show(machine(null))
    expect(text).toContain(t.account.machineLoginNewFolder)
    expect(text).toContain(t.account.machineLoginUnused('Example laptop'))
  })
})
