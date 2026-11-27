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
import { permissionAsk } from '../../../src/sessions/permission.js'
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
    state: live, command, deliver: command, transcript, session: async () => null, sentFileUrl: () => '/file.png', imageUrl: () => '/image.png',
    read: async () => [],
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
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chats/send', expect.objectContaining({ id: card.id, text: message })))
}

const bubbles = (host: HTMLElement) => [...host.querySelectorAll('.bubble')].map((each) => each.textContent)

it('keeps both external queue entries through a dequeue and checks only the copy that landed', async () => {
  const { host } = await midTurn({ listens: true, steers: false, mail: [] })
  const queued = { kind: 'prompt', at: new Date().toISOString(), text: message }
  transcript.mockResolvedValue({ lines: [], turn: { queued: [queued, { ...queued }] } })
  await act(async () => changed())
  const entries = [...host.querySelectorAll('li:has(> .bubble)')].filter(row => row.querySelector('.delivery--delivering'))
  expect(entries).toHaveLength(2)
  transcript.mockResolvedValue({ lines: [], turn: null })
  await act(async () => changed())
  transcript.mockResolvedValue({ lines: [queued], turn: null })
  await act(async () => changed())
  expect(bubbles(host)).toEqual(['Run the tests', message, message])
  expect(entries[0]?.querySelector('.delivery--delivered')).toBeTruthy()
  expect(entries[1]?.querySelector('.delivery--delivering')).toBeTruthy()
  expect(entries.every(row => host.contains(row))).toBe(true)
})

it('checks the original bubbles when one resume carries both messages', async () => {
  const messages = [letter(), letter({ id: 2, text: 'Also check the build' })]
  const mail: SessionMail = { listens: true, steers: false, mail: messages }
  const { host, rerender } = await midTurn(mail)
  const entries = [...host.querySelectorAll('.delivery--delivering')].map(mark => mark.closest('li')!)
  const at = new Date().toISOString()
  mail.mail = messages.map(each => ({ ...each, fate: 'delivered', event: 'resume', settledAt: at }))
  await rerender()
  transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at, text: messages.map(each => each.text).join('\n\n') }], turn: null })
  await act(async () => changed())
  expect(bubbles(host)).toEqual(['Run the tests', ...messages.map(each => each.text)])
  expect(entries).toHaveLength(2)
  expect(entries.every(row => host.contains(row) && row.querySelector('.delivery--delivered'))).toBe(true)
})

it('takes a message mid-turn from a session that steers and shows it in the feed', async () => {
  const { host, box } = await midTurn({ listens: true, steers: true, mail: [] })
  await sendNow(host, box, t.session.chat.steers)
  expect(bubbles(host)).toEqual(['Run the tests', message])
})

it("takes a message mid-turn for the session's inbox or hooks and keeps one bubble through delivery", async () => {
  const mail: SessionMail = { listens: true, steers: false, mail: [] }
  const { host, box, rerender } = await midTurn(mail)
  await sendNow(host, box, t.session.chat.mailbox)
  const entry = host.querySelector('.delivery--delivering')?.closest('li')
  expect(entry?.querySelector('.bubble')?.textContent).toBe(message)
  mail.mail = [letter()]
  await rerender()
  expect(host.querySelector('.delivery--delivering')?.closest('li')).toBe(entry)
  mail.mail = [{ ...mail.mail[0]!, fate: 'delivered', event: 'inbox' }]
  await rerender()
  expect(host.querySelector('.delivery--delivering')?.closest('li')).toBe(entry)
  transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at: new Date().toISOString(), text: message }], turn: null })
  await act(async () => changed())
  expect(bubbles(host)).toEqual(['Run the tests', message])
  expect(entry?.querySelector('.delivery--delivered')).toBeTruthy()
})

it('restores a returned send and its files ahead of the next draft once, including after reopening', async () => {
  const mail: SessionMail = { listens: true, steers: false, mail: [] }
  const { host, box, rerender } = await midTurn(mail)
  await attach(host, 'notes.txt')
  await sendNow(host, box, t.session.chat.mailbox)
  await type(box, 'Next')
  await attach(host, 'next.txt')
  await act(async () => root.render(null))
  mail.mail = [letter({ fate: 'returned', reason: 'gone', files: ['.temp/inbox/notes.txt'] })]
  await rerender()
  await vi.waitFor(() => expect(host.querySelector('.delivery--failed')?.textContent).toContain(t.session.chat.delivery.returned.gone))
  expect(host.querySelector('textarea')?.value).toBe(message + '\n\nNext')
  expect([...host.querySelectorAll('.chat__unfile')].map(button => button.getAttribute('aria-label')))
    .toEqual(['notes.txt', 'next.txt'].map(name => t.session.chat.removeFile(name)))
  await type(host.querySelector('textarea')!, 'Edited')
  await act(async () => root.render(null))
  await rerender()
  expect(host.querySelector('textarea')?.value).toBe('Edited')
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
  expect(host.querySelector('.chat__readonly')).toBeNull()
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

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

it('keeps a sent picture from the chosen file while the first session starts for minutes and after the transcript has it', async () => {
  const { host, delivery } = await start('one.png')
  await act(async () => delivery.resolve())
  const thumb = () => host.querySelector<HTMLImageElement>('.bubble .thumb img')
  const chosen = thumb()?.getAttribute('src')
  expect(chosen).toMatch(/^blob:/)
  vi.useFakeTimers()
  try {
    transcript.mockResolvedValue({ lines: [], turn: null })
    await render({ ...card, sessionId: 'first-session', state: 'starting' })
    await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000))
    expect(thumb()?.getAttribute('src')).toBe(chosen)
    expect(host.querySelector('.bubble .chat__file')).toBeNull()
    transcript.mockResolvedValue({ lines: [{ at: card.lastAt, kind: 'prompt', text: message, files: ['.temp/inbox/one.png'] }], turn: null })
    await act(async () => changed())
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect([...host.querySelectorAll('.bubble .thumb img')].map((img) => img.getAttribute('src'))).toEqual([chosen])
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a sent picture on view through the first session’s start and the delivery, and closes it on a handoff (BTN-1425)', async () => {
  const { host, delivery } = await start('one.png')
  await act(async () => host.querySelector<HTMLButtonElement>('.bubble .thumb')!.click())
  const viewer = () => host.querySelector<HTMLImageElement>('.viewer img:not(.viewer__next)')
  const chosen = viewer()?.getAttribute('src')
  expect(chosen).toMatch(/^blob:/)
  await act(async () => delivery.resolve())
  transcript.mockResolvedValue({ lines: [], turn: null })
  await render({ ...card, sessionId: 'first-session', state: 'working' })
  expect(viewer()?.getAttribute('src')).toBe(chosen)
  const landed: FeedLine = { at: card.lastAt, kind: 'prompt', text: message, files: ['C:\\repos\\example\\.temp\\inbox\\one.png'] }
  const read: FeedLine[] = [
    { at: card.lastAt, kind: 'tool', text: 'Read one.png', tool: 'toolu_a', name: 'Read', subject: 'C:\\repos\\example\\.temp\\inbox\\one.png' },
    { at: card.lastAt, kind: 'image', text: 'one.png', tool: 'toolu_a', images: 1 },
  ]
  for (const lines of [[landed], [landed, ...read]]) {
    transcript.mockResolvedValue({ lines, turn: null })
    await act(async () => changed())
    expect(host.querySelectorAll('.viewer img')).toHaveLength(1)
    expect(viewer()?.getAttribute('src')).toBe(chosen)
  }
  await render({ ...card, sessionId: 'second-session', state: 'working' })
  expect(host.querySelector('.viewer')).toBeNull()
})

/** Whether a sent picture's bubble ever drew a file chip in the records: added, or a class it had for a moment. */
const drewChip = (records: MutationRecord[]): boolean => records.some((record) => {
  if (record.type === 'attributes') return [record.oldValue ?? '', (record.target as Element).className].some((name) => name.includes('chat__file'))
  return [...record.addedNodes].some((node) => node.textContent?.includes('📎') || (node instanceof Element && node.matches('.chat__file, :has(.chat__file)')))
})

it('keeps a sent picture on the chosen file in a running chat once the transcript has it (BTN-1390, BTN-1425)', async () => {
  live = { config: { projects: {} }, branchDrift: {}, sessions: [], account: { accounts: [] }, mailbox: {} }
  transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at: card.lastAt, text: 'Run the tests' }], turn: null })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await render({ ...card, sessionId: 'first-session', state: 'waiting' })
  await vi.waitFor(() => expect(host.querySelector('.bubble')?.textContent).toBe('Run the tests'))
  const box = host.querySelector('textarea')!
  await type(box, message)
  await attach(host, 'one.png')
  command.mockResolvedValueOnce(undefined)
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__send')!.click())
  const shown = () => [...host.querySelectorAll<HTMLImageElement>('.bubble .thumb img')].filter((img) => !img.classList.contains('thumb__next'))
  await vi.waitFor(() => expect(shown().map((img) => img.getAttribute('src'))).toEqual([expect.stringMatching(/^blob:/)]))
  const chosen = shown()[0]!
  const observer = new MutationObserver(() => {})
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] })
  try {
    transcript.mockResolvedValue({
      lines: [{ kind: 'prompt', at: card.lastAt, text: 'Run the tests' }, { kind: 'prompt', at: card.lastAt, text: message, files: ['.temp/inbox/one.png'] }],
      turn: null,
    })
    await act(async () => changed())
    expect(host.querySelectorAll('.bubble .thumb img')).toHaveLength(1)
    expect(shown()).toEqual([chosen])
    expect(drewChip(observer.takeRecords())).toBe(false)
  } finally {
    observer.disconnect()
  }
})

it("shows a mailed picture as the chosen file's thumbnail while it waits for the hook and through its delivery (BTN-1431)", async () => {
  const mail: SessionMail = { listens: true, steers: false, mail: [] }
  const { host, box, rerender } = await midTurn(mail)
  await type(box, message)
  await attach(host, 'one.png')
  command.mockResolvedValueOnce(undefined)
  await act(async () => host.querySelector<HTMLButtonElement>('.chat__send')!.click())
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chats/send', expect.objectContaining({ text: message })))
  expect(host.querySelector('.delivery--delivering')).toBeTruthy()
  const files = ['C:\\repos\\example\\.temp\\inbox\\one.png']
  mail.mail = [letter({ files })]
  await rerender()
  const waiting = host.querySelector<HTMLImageElement>('.transcript__entry:has(.delivery--delivering) .thumb img')
  const chosen = waiting?.getAttribute('src')
  expect(chosen).toMatch(/^blob:/)
  expect(host.querySelector('.bubble .chat__file')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('.bubble .thumb')!.click())
  const viewer = () => host.querySelector<HTMLImageElement>('.viewer img:not(.viewer__next)')
  expect(viewer()?.getAttribute('src')).toBe(chosen)
  const observer = new MutationObserver(() => {})
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] })
  try {
    mail.mail = [letter({ files, fate: 'delivered', event: 'PostToolUse', settledAt: new Date().toISOString() })]
    transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at: card.lastAt, text: 'Run the tests' }, { kind: 'prompt', at: card.lastAt, text: message, files }], turn: null })
    await act(async () => changed())
    await rerender()
    expect([...host.querySelectorAll('.bubble .thumb img')].map((img) => img.getAttribute('src'))).toEqual([chosen])
    expect(host.querySelectorAll('.viewer img')).toHaveLength(1)
    expect(viewer()?.getAttribute('src')).toBe(chosen)
    expect(drewChip(observer.takeRecords())).toBe(false)
  } finally {
    observer.disconnect()
  }
})

it('opens the picture of a letter that came back, sent where the browser holds no copy (BTN-1431)', async () => {
  const files = ['C:\\repos\\example\\.temp\\inbox\\two.png']
  const { host } = await midTurn({ listens: true, steers: false, mail: [letter({ files, fate: 'returned', reason: 'asked', settledAt: new Date().toISOString() })] })
  const picture = host.querySelector<HTMLButtonElement>('.transcript__entry:has(.delivery--failed) button[aria-label]')!
  expect(picture.getAttribute('aria-label')).toBe(t.session.chat.openPicture('two.png'))
  await act(async () => picture.click())
  expect(host.querySelector('.viewer__name')?.textContent).toBe('two.png')
})

it('opens a sent picture from its chip and retries both images after a temporary 404', async () => {
  // The window opened after the send: the browser holds no copy of the picture.
  const settings = (window as unknown as HappyWindow).happyDOM.settings
  let available = false
  settings.fetch.interceptor = { beforeAsyncRequest: async ({ window }) => available ? new window.Response(png) : new window.Response(null, { status: 404 }) }
  settings.enableImageFileLoading = true
  vi.useFakeTimers()
  try {
    transcript.mockResolvedValue({ lines: [{ at: card.lastAt, kind: 'prompt', text: message, files: ['.temp/inbox/one.png'] }], turn: null })
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await render({ ...card, sessionId: 'first-session', state: 'working' })
    // Past the loader, short of the first retry.
    for (let step = 0; step < 4; step++) await act(async () => vi.advanceTimersByTimeAsync(150))
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

it('shows an archived chat its note and the way on inside the field frame, with no field', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const onContinue = vi.fn()
  const archived: ChatCard = { ...card, state: 'archived', archivedAt: new Date().toISOString() }
  await act(async () => root.render(createElement(ProjectChatWindow, { chat: archived, choice: null, onClose: () => {}, onContinue, onChanged: () => {}, onOpen: () => {} })))
  const frame = host.querySelector('.chat__box')!
  expect(frame.querySelector('textarea')).toBeNull()
  expect(host.querySelector('textarea')).toBeNull()
  expect(frame.querySelector('.chat__readonly')?.textContent).toBe(t.chats.window.archived)
  const button = frame.querySelector<HTMLButtonElement>('button')!
  expect(button.textContent).toBe(t.chats.window.continue)
  await act(async () => button.click())
  expect(onContinue).toHaveBeenCalledOnce()
})

async function permission(text?: string) {
  const ask = permissionAsk('tool-1', 'Bash', { command: 'cp a b && rm a' }, 'en')
  const session = { sessionId: 'first-session', ask, asking: true, lamp: 'waiting', waitingFor: 'permission prompt', feed: [] }
  live = { config: { projects: {} }, branchDrift: {}, sessions: [session], account: { accounts: [] }, mailbox: {} }
  transcript.mockResolvedValue({ lines: [{ kind: 'prompt', at: card.lastAt, text: 'Move the file' }], turn: null })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  const waiting = { ...card, sessionId: 'first-session', state: 'waiting' as const }
  await render(waiting)
  await vi.waitFor(() => expect(host.querySelector('.permission')).toBeTruthy())
  if (text !== undefined) await type(host.querySelector('textarea')!, text)
  return { host, ask, session, rerender: () => render(waiting) }
}

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>('.permission button')].find((each) => each.textContent === label)!

it('puts a waiting tool call over the field as Allow and Deny, with no question panel (BTN-1769)', async () => {
  const { host } = await permission()
  expect(host.querySelector('.permission__head')?.textContent).toBe(t.session.chat.permission.title('Bash', true))
  expect(host.querySelector('.permission__call')?.textContent).toBe('cp a b && rm a')
  expect(host.querySelector('.ask')).toBeNull()
  expect([...host.querySelectorAll('.permission button')].map((each) => each.textContent)).toEqual([t.session.chat.permission.deny, t.session.chat.permission.allow])
})

it('allows the call by its button with the words typed in the field, and the banner goes once the call is closed', async () => {
  const { host, ask, session, rerender } = await permission('then list the folder')
  command.mockResolvedValueOnce(undefined)
  await act(async () => button(host, t.session.chat.permission.allow).click())
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chats/send', expect.objectContaining({
    id: card.id, text: 'then list the folder', answers: { [ask.questions[0]!.question]: ask.questions[0]!.options[0]!.label },
  })))
  expect(host.querySelector('.permission')).toBeNull()
  Object.assign(session, { ask: null, asking: false, lamp: 'working', waitingFor: null })
  await rerender()
  expect(host.querySelector('.permission')).toBeNull()
})

it('denies the call by its button', async () => {
  const { host, ask } = await permission()
  command.mockResolvedValueOnce(undefined)
  await act(async () => button(host, t.session.chat.permission.deny).click())
  await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chats/send', expect.objectContaining({
    answers: { [ask.questions[0]!.question]: ask.questions[0]!.options[1]!.label },
  })))
})
