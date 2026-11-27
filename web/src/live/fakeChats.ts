import type { ChatCard, ChatChoice, ChatMachine, ChatMachines, ChatPage } from '../../../src/chats/model.js'
import { fail } from '../../../src/notice/notice.js'
import type { Mail, SessionMail } from '../../../src/sessions/mail.js'
import type { EvenKeelState, SessionView } from '../../../src/state.js'
import { FAKE_PERMISSION } from './fakeChat.js'
import { session } from './fakeSessions.js'

/** The archive's page, as the server's (BTN-1231). */
const PAGE = 20
/** How long a fake chat works on a message before it answers. */
const ANSWER_MS = 3_000

/** The service's answer to a chat recording (BTN-1391), by the `dictation` parameter. */
export async function fakeDictation(mode: string | null): Promise<{ text: string }> {
  await new Promise((done) => setTimeout(done, mode === 'slow' ? 8_000 : 900))
  if (mode === 'quota') throw fail('dictation.quota', {})
  if (mode === 'failed') throw fail('dictation.failed', {})
  return { text: 'Run npm test on the dev branch and fix the pull request.' }
}

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** The folder of `agent` the fake state has, else `fallback`: the account pill names a real entry. */
function accountOf(state: EvenKeelState, agent: string, fallback: string): string {
  return state.account.accounts.find((entry) => entry.agent === agent)?.key ?? fallback
}

/** The machines a project's chat may run on (BTN-1614): its pool, the own machine first; none — the own one alone. */
function poolOf(state: EvenKeelState, project: string): string[] {
  const own = state.ownMachine ?? 'pc'
  const pool = state.pools?.[project] ?? []
  return [own, ...pool.filter((id) => id !== own)]
}

/**
 * `chats/machines` of the fake: the own machine, the first one elsewhere with all but the first of the own accounts,
 * as its mirror would have them — without the hub's names, which the window puts back by e-mail (BTN-1670), and with
 * a folder signed out there, which it leaves out — and any further one off the link.
 */
function machinesOf(state: EvenKeelState, project: string): ChatMachines {
  const ids = poolOf(state, project)
  const far = state.account.accounts.slice(1).map((entry) => ({ ...entry, name: null }))
  const out = state.account.accounts[0] === undefined ? [] : [{ ...state.account.accounts[0], key: 'signed-out', name: null, needsLogin: true, limits: null }]
  const machines: ChatMachine[] = ids.map((id, index) => ({
    id,
    name: state.machineNames?.[id] ?? id,
    own: index === 0,
    block: index > 1 ? 'offline' : null,
    accounts: index === 1 ? { ...state.account, accounts: [...far, ...out] } : null,
  }))
  return { machines, picked: ids[0] ?? null }
}

function card(state: EvenKeelState, project: string, patch: Partial<ChatCard> & Pick<ChatCard, 'id'>): ChatCard {
  return {
    project,
    machine: state.ownMachine ?? 'pc',
    title: null,
    agent: 'claude',
    account: accountOf(state, 'claude', 'global'),
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    state: 'answered',
    context: { tokens: 24_000, window: 200_000 },
    last: null,
    lastAt: ago(5),
    unread: false,
    sessionId: null,
    archivedAt: null,
    successor: null,
    previous: null,
    ...patch,
  }
}

function active(state: EvenKeelState, project: string): ChatCard[] {
  const work = state.account.accounts.find((entry) => entry.agent === 'claude' && !entry.global)?.key ?? accountOf(state, 'claude', 'global')
  return [
    card(state, project, {
      id: `${project}-chat-1`,
      title: 'Why does the release script skip the changelog',
      account: work,
      state: 'waiting',
      context: { tokens: 24_000, window: 200_000 },
      last: { from: 'ask', text: 'Should the changelog step run before the version bump, or stay after it as the release notes expect?', at: ago(2) },
      lastAt: ago(2),
      sessionId: `${project}-chat-session-1`,
    }),
    card(state, project, {
      id: `${project}-chat-2`,
      // On the first machine elsewhere of a pool with several, so the card shows its machine.
      ...(poolOf(state, project)[1] === undefined ? {} : { machine: poolOf(state, project)[1] }),
      title: 'Plan the cache warm-up for long tasks',
      model: 'claude-opus-5-5',
      effort: 'high',
      state: 'answered',
      context: { tokens: 412_000, window: 1_000_000 },
      last: {
        from: 'agent',
        text: 'Three options fit the budget: a ping before the window runs out, a shorter prompt for the resume, or a fork that only reads. The first one is the cheapest and needs no change of the chain; the other two touch the session and need an entry in the exceptions list.',
        at: ago(9),
      },
      lastAt: ago(9),
      unread: true,
      sessionId: `${project}-chat-session-2`,
      // It goes on from the first archived chat, whose successor it is (BTN-1232).
      previous: `${project}-archived-1`,
    }),
    card(state, project, {
      id: `${project}-chat-3`,
      title: 'Read the flaky e2e logs',
      state: 'working',
      context: { tokens: 61_000, window: 200_000 },
      last: { from: 'user', text: 'Look at the last three runs of the chain e2e and tell me which step times out.', at: ago(1) },
      lastAt: ago(1),
      sessionId: `${project}-chat-session-3`,
    }),
    card(state, project, {
      id: `${project}-chat-4`,
      title: 'Sketch the export format',
      agent: 'codex',
      account: accountOf(state, 'codex', 'codex'),
      model: 'gpt-6.1-sol',
      effort: 'medium',
      state: 'cold',
      context: { tokens: 88_000, window: 400_000 },
      last: { from: 'agent', text: 'A JSON file per task with its comments inline is the simplest to import back.', at: ago(140) },
      lastAt: ago(140),
      sessionId: `${project}-chat-session-4`,
    }),
  ]
}

const ARCHIVED_TITLES = [
  'Rename the settings keys',
  'Check the badge colours',
  'Why the backup ran twice',
  'Draft the release notes',
  'Count the open questions',
  'Trace the slow page load',
  'Split the long settings file',
  'Review the tracker adapter',
  'Explain the limits poll',
  'Find the dead CSS rules',
]

function archived(state: EvenKeelState, project: string, successor: string): ChatCard[] {
  return Array.from({ length: 25 }, (_, index) =>
    card(state, project, {
      id: `${project}-archived-${index + 1}`,
      title: `${ARCHIVED_TITLES[index % ARCHIVED_TITLES.length]}${index < ARCHIVED_TITLES.length ? '' : ` (${Math.floor(index / ARCHIVED_TITLES.length) + 1})`}`,
      state: 'archived',
      context: null,
      last: { from: index % 3 === 0 ? 'user' : 'agent', text: index % 3 === 0 ? 'Thanks, that is enough for now.' : 'Done: the change is in the branch and the tests pass.', at: ago(60 * 24 * (index + 1)) },
      lastAt: ago(60 * 24 * (index + 1)),
      archivedAt: ago(60 * 24 * (index + 1) - 30),
      sessionId: `${project}-archived-session-${index + 1}`,
      // The first one went on in a new session (BTN-1232 writes the link; the fake shows how it looks).
      successor: index === 0 ? successor : null,
    }),
  )
}

/** `?chats=long`'s first chat: OpenCode on a free OpenRouter model whose catalogue name is long (BTN-1348). */
function longModelChat(state: EvenKeelState, project: string): ChatCard {
  return card(state, project, {
    id: `${project}-chat-long`,
    title: 'Compare the long model names',
    agent: 'opencode',
    account: accountOf(state, 'opencode', 'opencode'),
    model: 'openrouter/nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
    modelTitle: 'NVIDIA: Llama 3.1 Nemotron Ultra 253B v1 (free)',
    effort: 'high',
    context: { tokens: 96_000, window: 131_072 },
    last: { from: 'agent', text: 'The footer cuts the name and keeps the free badge.', at: ago(3) },
    lastAt: ago(3),
    sessionId: `${project}-chat-session-long`,
  })
}

/**
 * A letter of a fake chat's mailbox: the working chat's is waiting with a picture (BTN-1431), the cold Codex one's came
 * back (BTN-1346).
 */
function fakeMail(card: ChatCard): Mail[] {
  const letter = { id: 0, task: card.id, sessionId: card.sessionId ?? '', files: [], event: null, reason: null, settledAt: null }
  if (card.id.endsWith('-chat-3')) {
    const files = ['C:\\repos\\example-project\\.temp\\inbox\\paste-20261121-160801.png']
    return [{ ...letter, id: 1, text: 'Only the runs on the Windows runner, please.', files, postedAt: ago(0.5), fate: 'waiting' }]
  }
  if (card.id.endsWith('-chat-4'))
    return [{ ...letter, id: 2, text: 'Add the attachments to the format too.', postedAt: ago(142), fate: 'returned', reason: 'gone', settledAt: ago(141) }]
  return []
}

/**
 * The project chats of `dev:fake` (BTN-1231): `?chats=none` — none, `?chats=many` — a dozen active ones, `?chats=long`
 * an OpenCode one with a long model name first, `?chats=packages` a last choice with packages of its own, `?chats=empty`
 * an untitled chat with no session too; by default four active (waiting, answered unread, working, cold on
 * Codex) and 25 archived. Kept per page load, so a new chat, a message and a read stay until a reload.
 */
export function fakeChats(mode: string | null) {
  const lists = new Map<string, { active: ChatCard[]; archived: ChatCard[]; choice: ChatChoice | null }>()
  let made = 0

  const listOf = (state: EvenKeelState, project: string) => {
    let list = lists.get(project)
    if (list === undefined) {
      const cards = mode === 'none' ? [] : mode === 'long' ? [longModelChat(state, project), ...active(state, project)] : active(state, project)
      // `?chats=empty`: an untitled chat with no session yet, its menu offers Delete (BTN-1775).
      if (mode === 'empty') cards.unshift(card(state, project, { id: `${project}-empty`, title: null, state: 'new', context: null, last: null, sessionId: null, lastAt: ago(2) }))
      const extra =
        mode === 'many'
          ? Array.from({ length: 8 }, (_, index) =>
              card(state, project, { id: `${project}-extra-${index + 1}`, title: `Side question ${index + 1}`, last: { from: 'agent', text: 'Answered.', at: ago(30 + index * 20) }, lastAt: ago(30 + index * 20) }),
            )
          : []
      list = {
        active: [...cards, ...extra],
        archived: mode === 'none' ? [] : archived(state, project, cards[1]?.id ?? ''),
        choice:
          mode === 'none'
            ? null
            : {
                account: accountOf(state, 'claude', 'global'),
                model: 'claude-sonnet-5-5',
                effort: 'medium',
                // The "More" window with the chat's own values, one of a package out of the catalog (BTN-1696).
                ...(mode === 'packages' && { packages: { 'github@even-keel': true, forgejo: false, 'old-review@example': true } }),
                // The last chat went to the first machine elsewhere of a pool with several: the window offers it (BTN-1710).
                ...(poolOf(state, project)[1] !== undefined && { machine: poolOf(state, project)[1] }),
              },
      }
      lists.set(project, list)
    }
    return list
  }

  const find = (id: string) => {
    for (const list of lists.values()) {
      const found = list.active.find((each) => each.id === id)
      if (found !== undefined) return { list, found }
    }
    return undefined
  }

  const replace = (id: string, patch: Partial<ChatCard>): ChatCard | undefined => {
    const hit = find(id)
    if (hit === undefined) return undefined
    const next = { ...hit.found, ...patch }
    hit.list.active = hit.list.active.map((each) => (each.id === id ? next : each))
    return next
  }

  const sorted = (cards: ChatCard[]) =>
    [...cards].sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || b.lastAt.localeCompare(a.lastAt))

  return {
    /**
     * The page's mailbox rows of the chats' sessions: a Claude one's inbox is known (BTN-1345), the others ask for mail from
     * their hooks (BTN-1346). The working chat holds a waiting letter, the cold Codex one a returned letter.
     */
    mailbox(): Record<string, SessionMail> {
      const cards = [...lists.values()].flatMap((list) => list.active)
      return Object.fromEntries(
        cards.flatMap((card) => (card.sessionId === null ? [] : [[card.sessionId, { listens: true, steers: false, mail: fakeMail(card) }]])),
      )
    },
    /**
     * The views of the active chats' sessions, as the server's monitor finds a chat's session by its name: a working chat's
     * session works, so its window shows the turn line (BTN-1427). The others have none, as a session gone quiet; `ids`
     * names every chat session whose view the state drops first.
     */
    sessions(): { ids: Set<string>; views: SessionView[] } {
      const cards = [...lists.values()].flatMap((list) => list.active)
      const ids = new Set(cards.flatMap((card) => (card.sessionId === null ? [] : [card.sessionId])))
      const views = cards.flatMap((card): SessionView[] => {
        if (card.sessionId === null) return []
        const own = { sessionId: card.sessionId, agent: card.agent, account: card.account, model: card.model, effort: card.effort, branch: null }
        if (card.state === 'working') return [{ ...session(card.id, card.context?.tokens ?? 0, 'working'), ...own }]
        // `?chats=permission`: the first chat's session waits on a tool call to approve (BTN-1769).
        if (mode === 'permission' && card.state === 'waiting' && card.id.endsWith('-chat-1')) {
          return [{ ...session(card.id, card.context?.tokens ?? 0, 'waiting'), ...own, waitingFor: 'permission prompt', asking: true, ask: FAKE_PERMISSION }]
        }
        return []
      })
      return { ids, views }
    },
    /** The answer to a chats query; `undefined` — not one of them. */
    query(state: EvenKeelState, name: string, body: Record<string, unknown>): unknown {
      if (!name.startsWith('chats/')) return undefined
      const project = String(body.project ?? '')
      if (name === 'chats/list') {
        const list = listOf(state, project)
        return { chats: sorted(list.active), choice: list.choice }
      }
      if (name === 'chats/archive') {
        const words = String(body.words ?? '').trim().toLowerCase()
        const page = Number(body.page ?? 0)
        const matching = listOf(state, project).archived.filter(
          (each) => words === '' || `${each.title ?? ''} ${each.last?.text ?? ''}`.toLowerCase().includes(words),
        )
        return { chats: matching.slice(page * PAGE, (page + 1) * PAGE), more: matching.length > (page + 1) * PAGE } satisfies ChatPage
      }
      if (name === 'chats/machines') return machinesOf(state, project)
      if (name === 'chats/create') {
        const list = listOf(state, project)
        const choice: ChatChoice = { account: String(body.account), model: (body.model as string | null) ?? null, effort: (body.effort as string | null) ?? null }
        const agent = state.account.accounts.find((entry) => entry.key === choice.account)?.agent ?? 'claude'
        const machine = typeof body.machine === 'string' ? body.machine : (state.ownMachine ?? 'pc')
        made += 1
        const created = card(state, project, { id: `${project}-new-${made}`, agent, ...choice, machine, state: 'new', context: null, lastAt: new Date().toISOString() })
        list.active = [created, ...list.active]
        // The window opens with the last choice of packages (BTN-1696) and its machine (BTN-1710) again.
        list.choice = { ...choice, machine, ...(typeof body.packages === 'object' && body.packages !== null && { packages: body.packages as Record<string, boolean> }) }
        return created
      }
      if (name === 'chats/chat') {
        const id = String(body.id)
        return find(id)?.found ?? [...lists.values()].flatMap((list) => list.archived).find((each) => each.id === id) ?? null
      }
      if (name === 'chats/renew') {
        // The old chat goes to the archive with a link to the new one, which starts with the message (BTN-1232).
        const hit = find(String(body.id))
        if (hit === undefined) return null
        const choice: ChatChoice = { account: String(body.account), model: (body.model as string | null) ?? null, effort: (body.effort as string | null) ?? null }
        const agent = state.account.accounts.find((entry) => entry.key === choice.account)?.agent ?? 'claude'
        const text = String(body.text ?? '')
        const at = new Date().toISOString()
        // The new session may go to another machine (BTN-1711).
        const machine = typeof body.machine === 'string' ? body.machine : hit.found.machine
        made += 1
        const next = card(state, hit.found.project, {
          id: `${hit.found.project}-new-${made}`,
          agent,
          ...choice,
          ...(machine !== undefined && { machine }),
          title: hit.found.title,
          state: 'starting',
          context: null,
          last: { from: 'user', text, at },
          lastAt: at,
          previous: hit.found.id,
        })
        hit.list.active = [next, ...hit.list.active.filter((each) => each.id !== hit.found.id)]
        hit.list.archived = [{ ...hit.found, state: 'archived', archivedAt: at, successor: next.id, unread: false }, ...hit.list.archived]
        hit.list.choice = machine === undefined ? choice : { ...choice, machine }
        setTimeout(() => replace(next.id, { state: 'working', sessionId: `${next.id}-session` }), ANSWER_MS / 2)
        setTimeout(() => replace(next.id, { state: 'answered', unread: true, last: { from: 'agent', text: 'Picked up where the last chat stopped: the step waits on a port another run holds.', at: new Date().toISOString() } }), ANSWER_MS * 2)
        return next
      }
      return undefined
    },

    /** Runs a chats command; `false` — not one of them. */
    command(name: string, body: Record<string, unknown>): boolean {
      const id = String(body.id ?? '')
      if (name === 'chats/read') {
        replace(id, { unread: false })
        return true
      }
      if (name === 'chats/send') {
        const text = String(body.text ?? '')
        const at = new Date().toISOString()
        const hit = find(id)
        if (hit === undefined) return true
        replace(id, {
          title: hit.found.title ?? text.slice(0, 60),
          state: 'working',
          last: { from: 'user', text, at },
          lastAt: at,
          sessionId: hit.found.sessionId ?? `${id}-session`,
          context: hit.found.context ?? { tokens: 18_000, window: 200_000 },
        })
        setTimeout(() => {
          const now = new Date().toISOString()
          replace(id, { state: 'answered', unread: true, last: { from: 'agent', text: 'Here is what I found: the step waits on a port another run holds.', at: now }, lastAt: now })
        }, ANSWER_MS)
        return true
      }
      // The ⋯ menu (BTN-1775): a chat with a session goes to the archive, an empty one is gone for good.
      if (name === 'chats/hide' || name === 'chats/delete') {
        const hit = find(id)
        if (hit === undefined) return true
        hit.list.active = hit.list.active.filter((each) => each.id !== id)
        if (name === 'chats/hide') hit.list.archived = [{ ...hit.found, state: 'archived', archivedAt: new Date().toISOString(), unread: false }, ...hit.list.archived]
        return true
      }
      return name.startsWith('chats/')
    },
  }
}
