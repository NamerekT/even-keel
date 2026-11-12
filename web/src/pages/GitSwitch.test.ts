// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { GitOnSection } from './GitSwitch.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})

const command = vi.hoisted(() => ({ send: vi.fn(async () => false), sending: false, failure: null as null | { code: 'git.noIdentity'; params: Record<string, never> } }))
const busy = vi.hoisted(() => ({ value: false }))
vi.mock('../live/useCommand.js', () => ({ useCommand: () => command }))
vi.mock('./gitSwitchBusy.js', () => ({ gitSwitchBusy: () => busy.value }))
vi.mock('./SetupGit.js', () => ({ GitInstall: () => null, Identity: () => null }))
const changes = vi.hoisted(() => ({ files: [] as string[] }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ query: async () => ({ files: changes.files }) }) }))

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  command.send.mockClear()
  command.sending = false
  command.failure = null
  busy.value = false
  changes.files = []
})

async function open(git: EvenKeelState['git'] = { version: '2.47.1', name: 'John Doe', email: 'john@example.com' }) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const state = { git, projectLabels: { p1: 'ABC' }, config: { projects: { p1: { name: null } } } } as unknown as EvenKeelState
  await act(async () => root.render(createElement(GitOnSection, { state, project: 'p1' })))
  const opener = [...host.querySelectorAll('button')].find((button) => button.textContent === t.settings.gitSwitch.on)!
  await act(async () => opener.click())
  return document.querySelector('dialog')!
}

describe('the Turn on git dialog', () => {
  it.each([
    [{ version: null, name: null, email: null }, 'needGit'],
    [{ version: '2.47.1', name: null, email: 'john@example.com' }, 'needIdentity'],
    [{ version: '2.47.1', name: 'John Doe', email: null }, 'needIdentity'],
  ] as const)('explains missing prerequisites without sending a command', async (git, reason) => {
    const dialog = await open(git)
    const button = dialog.querySelector<HTMLButtonElement>('.button--primary')!
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.parentElement!.textContent).toContain(t.settings.gitSwitch[reason])
    await act(async () => button.click())
    expect(command.send).not.toHaveBeenCalled()
  })

  it('keeps the refusal outside the scrolling body, next to the actions', async () => {
    command.failure = { code: 'git.noIdentity', params: {} }
    const dialog = await open()
    const alert = dialog.querySelector('[role="alert"]')!
    expect(alert.closest('.add-package__body')).toBeNull()
    expect(alert.nextElementSibling?.tagName).toBe('FOOTER')
  })

  it('blocks another press while sending', async () => {
    command.sending = true
    const dialog = await open()
    const button = dialog.querySelector<HTMLButtonElement>('.button--primary')!
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(command.send).not.toHaveBeenCalled()
  })

  it('sends the worktree choice once ready', async () => {
    const dialog = await open()
    const button = dialog.querySelector<HTMLButtonElement>('.button--primary')!
    expect(button.getAttribute('aria-disabled')).toBeNull()
    await act(async () => button.click())
    expect(command.send).toHaveBeenCalledWith('project/git', { project: 'p1', on: true, slot: 0, commit: true })
  })

  it('shows no changes card for a folder without uncommitted changes', async () => {
    const dialog = await open()
    expect(dialog.querySelector('.git-on__files')).toBeNull()
  })

  it('lists the first uncommitted changes and sends the unticked choice', async () => {
    changes.files = Array.from({ length: 23 }, (_, index) => `M file-${index}.txt`)
    const dialog = await open()
    const items = [...dialog.querySelectorAll('.git-on__files li')].map((item) => item.textContent)
    expect(items).toHaveLength(21)
    expect(items[0]).toBe('M file-0.txt')
    expect(items[20]).toBe(t.settings.gitSwitch.changesMore(3))
    await act(async () => dialog.querySelector<HTMLInputElement>('#git-on-commit')!.click())
    await act(async () => dialog.querySelector<HTMLButtonElement>('.button--primary')!.click())
    expect(command.send).toHaveBeenCalledWith('project/git', { project: 'p1', on: true, slot: 0, commit: false })
  })

  it('replaces the list with the one a refusal carries', async () => {
    changes.files = ['M old.txt']
    command.failure = { code: 'project.gitDirty', params: { project: 'ABC', files: ['?? fresh/'] } } as never
    const dialog = await open()
    expect([...dialog.querySelectorAll('.git-on__files li')].map((item) => item.textContent)).toEqual(['?? fresh/'])
  })
})
