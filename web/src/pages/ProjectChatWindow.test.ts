// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Window as HappyWindow } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatCard } from '../../../src/chats/model.js'
import type { Mail, SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { t } from '../i18n/index.js'
import type { Draft } from './chatDraft.js'
import { ProjectChatWindow } from './ProjectChatWindow.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value() {} },
  hidePopover: { configurable: true, value() {} },
})
const command = vi.fn()
const transcript = vi.fn()
const saved = new Map<string, Draft>()
vi.mock('./chatDraft.js', async (original) => ({
  ...await original<typeof import('./chatDraft.js')>(),
  readDraft: async (key: string) => saved.get(key) ?? null,
  writeDraft: async (key: string, _task: string, value: Draft) => { saved.set(key, value) },
}))
let changed: () => void
let live: unknown = null
vi.mock('../live/context.js', () => ({
  useLive: () => ({
    state: live, command, deliver: command, transcript, session: async () => null, sentFileUrl: () => '/file.png',
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

async function type(box: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function attach(host: HTMLElement, name: string) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['sample'], name)] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

async function start(file?: string) {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await render(card)
  expect(host.querySelector('.transcript__blank')?.textContent).toBe(t.chats.window.blank)
  expect(host.textContent).not.toContain(t.common.reading)
  const box = host.querySelector('textarea')!
  await type(box, message)
  if (file) await attach(host, file)
  let resolve!: () => void
  let reject!: (error: Error) => void
  command.mockReturnValueOnce(new Promise<void>((yes, no) => { resolve = yes; reject = no }))
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__send')!.click())
  await vi.waitFor(() => expect(command).toHaveBeenCalled())
  return { host, box, delivery: { resolve, reject } }
}

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  saved.clear()
  live = null
  vi.clearAllMocks()
})

const letter = (fields: Partial<Mail> = {}): Mail => ({
  id: 1, task: card.id, sessionId: 'first-session', text: message, files: [], postedAt: new Date().toISOString(),
  fate: 'waiting', event: null, reason: null, settledAt: null, ...fields,
})

async function midTurn(mail: SessionMail) {
  live = { config: { projects: {} }, branchDrift: {}, sessions: [], account: { accounts: [] }, mailbox: { 'first-session': mail } }
  transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at: card.lastAt, text: 'Run the tests' }], turn: null })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const working = { ...card, sessionId: 'first-session', state: 'working' as const }
  await render(working)
  await vi.waitFor(() => expect(host.querySelector('.bubble')?.textContent).toBe('Run the tests'))
  const box = host.querySelector('textarea')!
  expect(box.placeholder).not.toBe(t.session.chat.working)
  return { host, box, rerender: () => render(working) }
}

async function sendNow(host: HTMLElement, box: HTMLTextAreaElement, tip: string) {
  await type(box, message)
  const send = host.querySelector<HTMLButtonElement>('.chat__send')!
  expect(send.getAttribute('aria-disabled')).not.toBe('true')
  expect(send.closest('.tipped')?.textContent).toContain(tip)
  command.mockResolvedValueOnce(undefined)
  await act(async () => send.click())
  expect(command).toHaveBeenCalledWith('chats/send', expect.objectContaining({ id: card.id, text: message }))
}

const bubbles = (host: HTMLElement) => [...host.querySelectorAll('.bubble')].map((each) => each.textContent)

it('takes a message mid-turn from a session that steers and shows it in the feed', async () => {
  const { host, box } = await midTurn({ listens: true, steers: true, mail: [] })
  await sendNow(host, box, t.session.chat.steers)
  expect(bubbles(host)).toEqual(['Run the tests', message])
})

it("takes a message mid-turn for the session's inbox or hooks and shows it as the mailbox's letter (BTN-1346)", async () => {
  const mail: SessionMail = { listens: true, steers: false, mail: [] }
  const { host, box, rerender } = await midTurn(mail)
  await sendNow(host, box, t.session.chat.mailbox)
  expect(bubbles(host)).toEqual(['Run the tests'])
  mail.mail = [letter()]
  await rerender()
  expect(host.querySelector('.chat__letter--waiting')?.textContent).toBe(message + t.session.chat.mail.waiting)
})

it('shows a letter the mailbox gave back, and Reply puts its words into the field (BTN-1346)', async () => {
  const { host, box } = await midTurn({ listens: true, steers: false, mail: [letter({ fate: 'returned', reason: 'gone', settledAt: new Date().toISOString() })] })
  const returned = host.querySelector('.chat__letter--returned')!
  expect(returned.textContent).toContain(t.session.chat.mail.returned.gone)
  const reply = [...returned.querySelectorAll('button')].find((each) => each.textContent === t.session.chat.mail.reply)!
  await act(async () => reply.click())
  expect(box.value).toBe(message)
})

it('shuts the field mid-turn for a session that takes no message then', async () => {
  live = { config: { projects: {} }, branchDrift: {}, sessions: [], account: { accounts: [] }, mailbox: {} }
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await render({ ...card, sessionId: 'first-session', state: 'working' })
  expect(host.querySelector('textarea')!.placeholder).toBe(t.session.chat.working)
})

it('reopens empty during upload and keeps the next draft after success', async () => {
  const { host, delivery } = await start('one.png')
  await act(async () => root.render(null))
  await render(card)
  const box = host.querySelector('textarea')!
  expect(box.value).toBe('')
  expect(host.querySelector('.chat__tile')).toBeNull()
  await type(box, 'Next')
  const send = host.querySelector<HTMLButtonElement>('.chat__send')!
  expect(send.getAttribute('aria-disabled')).toBe('true')
  await act(async () => send.click())
  expect(command).toHaveBeenCalledTimes(1)
  await act(async () => delivery.resolve())
  await act(async () => root.render(null))
  await render(card)
  expect(host.querySelector('textarea')!.value).toBe('Next')
})

it.each(['open', 'closed', 'reopened'])('prepends failed text and files when the chat is %s', async (window) => {
  const { host, box, delivery } = await start('one.png')
  expect(box.disabled).toBe(false)
  await type(box, 'Next')
  await attach(host, 'two.png')
  if (window !== 'open') await act(async () => root.render(null))
  if (window === 'reopened') await render(card)
  await act(async () => delivery.reject(new Error('upload refused')))
  if (window === 'closed') await render(card)
  expect(host.querySelector('textarea')!.value).toBe(message + '\n\nNext')
  expect([...host.querySelectorAll('.chat__tile .chat__unfile')].map(cross => cross.getAttribute('aria-label')))
    .toEqual([t.session.chat.removeFile('one.png'), t.session.chat.removeFile('two.png')])
  expect(host.querySelector('[role=alert]')?.textContent).toContain('upload refused')
})

it('shows a refused send as a banner over the field; its ✕ closes it for good and keeps the text', async () => {
  const { host, delivery } = await start()
  await act(async () => delivery.reject(new Error('upload refused')))
  const banner = host.querySelector('.chat-banner')!
  expect(banner.textContent).toContain('upload refused')
  expect(banner.compareDocumentPosition(host.querySelector('textarea')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await act(async () => banner.querySelector<HTMLButtonElement>('.chat-banner__close')!.click())
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.querySelector('textarea')!.value).toBe(message)
  await act(async () => root.render(null))
  await render(card)
  await vi.waitFor(() => expect(host.querySelector('textarea')!.value).toBe(message))
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('opens empty, keeps one bubble through the launch and missing transcript, then displays the recorded prompt', async () => {
  const { host, box, delivery } = await start()
  expect(box.value).toBe('')
  expect(host.querySelector('.bubble')?.textContent).toBe(message)
  expect(box.placeholder).toBe(t.chats.window.starting)
  expect(host.querySelector('.chat__send')?.closest('.tipped')?.textContent).toContain(t.chats.window.starting)
  expect(host.querySelector('.chat__hint')).toBeNull()
  await act(async () => delivery.resolve())
  expect(box.placeholder).toBe(t.chats.window.starting)
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

it('keeps the same bubble from the send to the landed transcript line and turns only its mark', async () => {
  const { host, delivery } = await start()
  const entry = host.querySelector('.bubble')!.closest('li')!
  const bubble = host.querySelector('.bubble')!
  expect(entry.querySelector('.delivery')?.classList.contains('delivery--delivering')).toBe(true)
  expect(entry.querySelector('.delivery [role=img]')?.getAttribute('aria-label')).toBe(t.session.chat.delivery.delivering)
  await act(async () => delivery.resolve())
  transcript.mockResolvedValue({ lines: [], turn: null })
  await render({ ...card, sessionId: 'first-session', state: 'working' })
  // The transcript lands with lines before the prompt: the entry moves, the bubble stays the same element.
  const lines: FeedLine[] = [
    { kind: 'text', at: card.lastAt, text: 'Session started' },
    { kind: 'prompt', at: card.lastAt, text: message },
  ]
  transcript.mockResolvedValue({ lines, turn: null })
  await act(async () => changed())
  expect(host.querySelectorAll('.bubble')).toHaveLength(1)
  expect(host.querySelector('.bubble')).toBe(bubble)
  expect(bubble.closest('li')).toBe(entry)
  expect(entry.querySelector('.delivery')?.classList.contains('delivery--delivered')).toBe(true)
  expect(entry.querySelector('.delivery [role=img]')?.getAttribute('aria-label')).toContain(t.session.chat.delivery.delivered(null))
  expect(entry.querySelector('[title]')).toBeNull()
})

it('marks the message as not delivered and puts it back in the field when the launch fails', async () => {
  const { host, box, delivery } = await start()
  expect(box.value).toBe('')
  await act(async () => delivery.reject(new Error('launch failed')))
  expect(box.value).toBe(message)
  expect(host.querySelector('.bubble')?.textContent).toBe(message)
  expect(host.querySelector('.delivery')?.classList.contains('delivery--failed')).toBe(true)
  expect(host.querySelector('.chat__send')?.hasAttribute('disabled')).toBe(false)
  command.mockResolvedValueOnce(undefined)
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__send')!.click())
  expect([...host.querySelectorAll('.bubble')].map(each => each.textContent)).toEqual([message])
  expect(host.querySelector('.delivery')?.classList.contains('delivery--delivering')).toBe(true)
})

it('opens a sent picture from its chip and retries both images after a temporary 404', async () => {
  const { host, delivery } = await start('one.png')
  await act(async () => delivery.resolve())
  const settings = (window as unknown as HappyWindow).happyDOM.settings
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  let available = false
  settings.fetch.interceptor = { beforeAsyncRequest: async ({ window }) => available ? new window.Response(png) : new window.Response(null, { status: 404 }) }
  settings.enableImageFileLoading = true
  vi.useFakeTimers()
  try {
    transcript.mockResolvedValue({ lines: [{ at: card.lastAt, kind: 'prompt', text: message, files: ['.temp/inbox/one.png'] }], turn: null })
    await render({ ...card, sessionId: 'first-session', state: 'working' })
    const chip = host.querySelector<HTMLButtonElement>('button.chat__file')!
    expect(chip?.textContent).toContain('one.png')
    await act(async () => chip.click())
    expect(host.querySelector('.viewer__name')?.textContent).toBe('one.png')
    expect(host.querySelector<HTMLImageElement>('.viewer img')?.naturalWidth).toBe(0)
    available = true
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(host.querySelector<HTMLImageElement>('.bubble .thumb img')?.naturalWidth).toBe(1)
    expect(host.querySelector<HTMLImageElement>('.viewer img')?.naturalWidth).toBe(1)
  } finally {
    settings.enableImageFileLoading = false
    settings.fetch.interceptor = null
    vi.useRealTimers()
  }
})
