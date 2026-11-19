// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatCard } from '../../../src/chats/model.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { t } from '../i18n/index.js'
import { ProjectChatWindow } from './ProjectChatWindow.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const command = vi.fn()
const transcript = vi.fn()
let changed: () => void
vi.mock('../live/context.js', () => ({
  useLive: () => ({
    state: null, command, transcript, session: async () => null,
    onTranscript: (_id: string, listener: () => void) => { changed = listener; return () => {} },
  }),
}))

let root: Root
const card: ChatCard = {
  id: 'chat-000000000001', project: 'project', title: null, agent: 'claude', account: 'global', model: 'haiku', effort: null,
  state: 'new', context: null, last: null, lastAt: new Date().toISOString(), unread: false, sessionId: null,
  archivedAt: null, successor: null, previous: null,
}
const message = 'Where are the tests?'

async function render(chat: ChatCard) {
  const noop = () => {}
  await act(async () => root.render(createElement(ProjectChatWindow, { chat, choice: null, onClose: noop, onContinue: noop, onChanged: noop, onOpen: noop })))
}

async function start() {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await render(card)
  expect(host.querySelector('.transcript__blank')?.textContent).toBe(t.chats.window.blank)
  expect(host.textContent).not.toContain(t.common.reading)
  const box = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, message)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  let resolve!: () => void
  let reject!: (error: Error) => void
  command.mockReturnValueOnce(new Promise<void>((yes, no) => { resolve = yes; reject = no }))
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__send')!.click())
  return { host, box, delivery: { resolve, reject } }
}

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

it('opens empty, keeps one bubble through the launch and missing transcript, then displays the recorded prompt', async () => {
  const { host, box, delivery } = await start()
  expect(box.value).toBe('')
  expect(host.querySelector('.bubble')?.textContent).toBe(message)
  expect(host.querySelector('.chat__hint')?.textContent).toBe(t.chats.window.starting)
  await act(async () => delivery.resolve())
  expect(host.querySelector('.chat__hint')?.textContent).toBe(t.chats.window.starting)
  transcript.mockResolvedValue(null)
  await render({ ...card, sessionId: 'first-session', state: 'working' })
  expect(host.textContent).not.toContain(t.session.notFound)
  expect(host.querySelector('.bubble')?.textContent).toBe(message)
  transcript.mockResolvedValue({ lines: [], turn: null })
  await act(async () => changed())
  expect(host.querySelector('.bubble')?.textContent).toBe(message)
  const prompt: FeedLine = { kind: 'prompt', at: card.lastAt, text: message }
  transcript.mockResolvedValue({ lines: [prompt], turn: null })
  await act(async () => changed())
  expect([...host.querySelectorAll('.bubble')].map(each => each.textContent)).toEqual([message])
})

it('puts the message back in the field when the launch fails', async () => {
  const { host, box, delivery } = await start()
  expect(box.value).toBe('')
  await act(async () => delivery.reject(new Error('launch failed')))
  expect(box.value).toBe(message)
  expect(host.querySelector('.bubble')).toBeNull()
  expect(host.querySelector('.chat__send')?.hasAttribute('disabled')).toBe(false)
})
