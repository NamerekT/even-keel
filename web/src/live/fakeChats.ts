import type { ChatCard, ChatChoice, ChatPage } from '../../../src/chats/model.js'
import type { SessionMail } from '../../../src/sessions/mail.js'
import type { EvenKeelState } from '../../../src/state.js'

/** The archive's page, as the server's (BTN-1231). */
const PAGE = 20
/** How long a fake chat works on a message before it answers. */
const ANSWER_MS = 3_000

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** The folder of `agent` the fake state has, else `fallback`: the account pill names a real entry. */
function accountOf(state: EvenKeelState, agent: string, fallback: string): string {
  return state.account.accounts.find((entry) => entry.agent === agent)?.key ?? fallback
}

function card(state: EvenKeelState, project: string, patch: Partial<ChatCard> & Pick<ChatCard, 'id'>): ChatCard {
  return {
    project,
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

/**
 * The project chats of `dev:fake` (BTN-1231): `?chats=none` — none, `?chats=many` — a dozen active ones; by default
 * four active (waiting, answered unread, working, cold on Codex) and 25 archived. Kept per page load, so a new chat, a
 * message and a read stay until a reload.
 */
export function fakeChats(mode: string | null) {
  const lists = new Map<string, { active: ChatCard[]; archived: ChatCard[]; choice: ChatChoice | null }>()
  let made = 0

  const listOf = (state: EvenKeelState, project: string) => {
    let list = lists.get(project)
    if (list === undefined) {
      const cards = mode === 'none' ? [] : active(state, project)
      const extra =
        mode === 'many'
          ? Array.from({ length: 8 }, (_, index) =>
              card(state, project, { id: `${project}-extra-${index + 1}`, title: `Side question ${index + 1}`, last: { from: 'agent', text: 'Answered.', at: ago(30 + index * 20) }, lastAt: ago(30 + index * 20) }),
            )
          : []
      list = {
        active: [...cards, ...extra],
        archived: mode === 'none' ? [] : archived(state, project, cards[1]?.id ?? ''),
        choice: mode === 'none' ? null : { account: accountOf(state, 'claude', 'global'), model: 'claude-sonnet-5-5', effort: 'medium' },
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
    /** The page's mailbox rows of the chats' Claude sessions: a live `--bg` session's inbox is known, so it takes a message mid-turn (BTN-1345). */
    mailbox(): Record<string, SessionMail> {
      const cards = [...lists.values()].flatMap((list) => list.active)
      return Object.fromEntries(cards.flatMap((card) => (card.agent === 'claude' && card.sessionId !== null ? [[card.sessionId, { listens: true, steers: false, mail: [] }]] : [])))
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
      if (name === 'chats/create') {
        const list = listOf(state, project)
        const choice: ChatChoice = { account: String(body.account), model: (body.model as string | null) ?? null, effort: (body.effort as string | null) ?? null }
        const agent = state.account.accounts.find((entry) => entry.key === choice.account)?.agent ?? 'claude'
        made += 1
        const created = card(state, project, { id: `${project}-new-${made}`, agent, ...choice, state: 'new', context: null, lastAt: new Date().toISOString() })
        list.active = [created, ...list.active]
        list.choice = choice
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
        made += 1
        const next = card(state, hit.found.project, {
          id: `${hit.found.project}-new-${made}`,
          agent,
          ...choice,
          title: hit.found.title,
          state: 'starting',
          context: null,
          last: { from: 'user', text, at },
          lastAt: at,
          previous: hit.found.id,
        })
        hit.list.active = [next, ...hit.list.active.filter((each) => each.id !== hit.found.id)]
        hit.list.archived = [{ ...hit.found, state: 'archived', archivedAt: at, successor: next.id, unread: false }, ...hit.list.archived]
        hit.list.choice = choice
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
      return name.startsWith('chats/')
    },
  }
}
