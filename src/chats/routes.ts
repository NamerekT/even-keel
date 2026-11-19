import type { IncomingMessage } from 'node:http'
import { fail } from '../notice/notice.js'
import type { ServerDeps } from '../server.js'
import { numberOf, projectOf, textOf } from '../server-request.js'
import type { ChatMessageIn, ProjectChats } from './chats.js'
import type { ChatChoice } from './model.js'

type Query = (deps: ServerDeps, body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>

/** A message carries its files whole, as an answer from the page does. */
const MESSAGE_BYTES = 64 * 1024 * 1024
export const CHATS_BODY_LIMITS: Record<string, number> = { '/api/chats/send': MESSAGE_BYTES, '/api/chats/renew': MESSAGE_BYTES }

/** The page's calls on the project chats (BTN-1230, `docs/sessions/project-chats.md`); each answers with its result. */
export const CHATS_QUERIES: Record<string, Query> = {
  'chats/list': async (deps, body) => ({ chats: chats(deps).list(projectOf(body)), choice: chats(deps).choice(projectOf(body)) }),
  'chats/archive': (deps, body) => chats(deps).archived(projectOf(body), textOf(body.words ?? '', 'words'), pageOf(body)),
  'chats/chat': (deps, body) => chats(deps).card(idOf(body)),
  'chats/create': (deps, body) => chats(deps).create(projectOf(body), choiceOf(body)),
  'chats/send': (deps, body) => chats(deps).send(idOf(body), messageOf(body)),
  'chats/renew': (deps, body) => chats(deps).renew(idOf(body), messageOf(body), choiceOf(body)),
  'chats/read': async (deps, body) => {
    chats(deps).read(idOf(body))
    return {}
  },
  'chats/hide': async (deps, body) => {
    await chats(deps).archive(idOf(body))
    return {}
  },
}

function chats({ chats }: ServerDeps): ProjectChats {
  if (chats === undefined) throw fail('chats.unknown', {})
  return chats
}

const idOf = (body: Record<string, unknown>): string => {
  const id = textOf(body.id, 'id')
  if (id === '') throw fail('request.required', { field: 'id' })
  return id
}

function pageOf(body: Record<string, unknown>): number {
  const page = body.page === undefined ? 0 : numberOf(body.page, 'page')
  if (!Number.isInteger(page) || page < 0) throw fail('request.required', { field: 'page' })
  return page
}

const optionalText = (raw: unknown, field: string): string | null => (raw === null || raw === undefined || raw === '' ? null : textOf(raw, field))

function choiceOf(body: Record<string, unknown>): ChatChoice {
  const account = textOf(body.account, 'account')
  if (account === '') throw fail('request.required', { field: 'account' })
  return { account, model: optionalText(body.model, 'model'), effort: optionalText(body.effort, 'effort') }
}

function messageOf(body: Record<string, unknown>): ChatMessageIn {
  const { answers, files } = body
  const answered = typeof answers === 'object' && answers !== null && !Array.isArray(answers) ? Object.entries(answers) : []
  const sent = Array.isArray(files) ? files : []
  if (!answered.every(([, value]) => typeof value === 'string')) throw fail('request.required', { field: 'answers' })
  if (!sent.every((file) => typeof file?.name === 'string' && typeof file?.data === 'string')) throw fail('request.required', { field: 'files' })
  return {
    text: typeof body.text === 'string' ? body.text : '',
    answers: Object.fromEntries(answered) as Record<string, string>,
    files: sent.map((file: { name: string; data: string }) => ({ name: file.name, data: Buffer.from(file.data, 'base64') })),
  }
}
