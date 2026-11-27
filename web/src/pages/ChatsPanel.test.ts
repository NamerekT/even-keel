// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatCard } from '../../../src/chats/model.js'
import { fail } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { ChatsPanel } from './ChatsPanel.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})
const command = vi.fn()
vi.mock('../live/context.js', () => ({
  useLive: () => ({ state: null, command, read: async () => ({ chats: [], more: false }) }),
}))
// The window of an early continue as a stub: its button hands over the chat the service made (BTN-1776).
vi.mock('./ChatContinueDialog.js', () => ({
  ChatContinueDialog: ({ chat, onContinued }: { chat: ChatCard; onContinued: (next: ChatCard) => void }) =>
    createElement('dialog', { open: true, className: 'continue-stub' }, createElement('button', { type: 'button', onClick: () => onContinued({ ...chat, id: `${chat.id}-next`, sessionId: null, state: 'new', previous: chat.id }) }, 'go')),
}))

const chat = (id: string, patch: Partial<ChatCard> = {}): ChatCard => ({
  id, project: 'project', title: id, agent: 'claude', account: 'global', model: null, effort: null, state: 'answered', context: null,
  last: null, lastAt: new Date().toISOString(), unread: false, sessionId: `${id}-session`, archivedAt: null, successor: null, previous: null,
  ...patch,
})

let root: Root
let host: HTMLElement
const refresh = vi.fn()

async function render(chats: ChatCard[]) {
  await act(async () => root.render(createElement(ChatsPanel, { project: 'project', chats: { chats, choice: null, failed: false, refresh }, onClose: () => {} })))
}

async function pick(id: string, label: string) {
  const item = [...host.querySelectorAll('.chats__item')].find((each) => each.querySelector('.chat-card__text')?.textContent === id)!
  await act(async () => item.querySelector<HTMLButtonElement>('.chat-card__more button')!.click())
  const line = [...item.querySelectorAll<HTMLButtonElement>('.more-menu__item')].find((each) => each.textContent === label)!
  await act(async () => line.click())
  return item
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  command.mockReset()
  refresh.mockReset()
})

it("archives a chat from its card's ⋯ without opening it: the card leaves, the list is read again (BTN-1775)", async () => {
  command.mockResolvedValue(undefined)
  await render([chat('first'), chat('second')])
  const item = await pick('first', t.chats.menu.archive)
  expect(command).toHaveBeenCalledWith('chats/hide', { id: 'first' })
  expect(item.classList.contains('chats__item--leaving')).toBe(true)
  expect(document.querySelector('dialog')).toBeNull()
  expect(refresh).toHaveBeenCalledOnce()
})

it("continues a chat from its card's ⋯ in a window first; once continued the card leaves and the list is read again (BTN-1776)", async () => {
  await render([chat('first'), chat('second')])
  const item = await pick('first', t.chats.menu.continue)
  expect(command).not.toHaveBeenCalled()
  expect(item.classList.contains('chats__item--leaving')).toBe(false)
  await act(async () => document.querySelector<HTMLButtonElement>('.continue-stub button')!.click())
  expect(document.querySelector('.continue-stub')).toBeNull()
  expect(item.classList.contains('chats__item--leaving')).toBe(true)
  expect(refresh).toHaveBeenCalledOnce()
})

it('deletes an empty chat from its card and gives the card back with the reason when the service refuses (BTN-1775)', async () => {
  command.mockRejectedValue(fail('chats.hasSession', {}))
  await render([chat('empty', { state: 'new', sessionId: null })])
  const item = await pick('empty', t.chats.menu.delete)
  expect(command).toHaveBeenCalledWith('chats/delete', { id: 'empty' })
  expect(item.classList.contains('chats__item--leaving')).toBe(false)
  expect(host.querySelector('[role=alert]')?.textContent).toBe(say({ code: 'chats.hasSession', params: {} }))
  expect(refresh).not.toHaveBeenCalled()
})
