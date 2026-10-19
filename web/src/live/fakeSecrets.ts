import { fail } from '../../../src/notice/notice.js'
import { secretCatalog } from '../../../src/secrets/catalog.js'
import type { EvenKeelState, SecretsView } from '../../../src/state.js'
import type { TallyMode } from '../../../src/stats/mode.js'

const SET = new Set(['TALLY_DB_HOST', 'TALLY_WRITER_PASSWORD'])

/**
 * The "Access" tab's keys besides the profiles: Tally's host and writer password set, the rest not.
 * `?secrets=` adds `outer` — `TALLY_DB_HOST` from the service's environment, `pending` — a removal waits.
 */
export function fakeSecrets(mode: string | null): SecretsView {
  return {
    variables: secretCatalog().map((spec) => {
      const outer = mode === 'outer' && spec.name === 'TALLY_DB_HOST'
      const set = SET.has(spec.name)
      return {
        ...spec,
        set,
        value: spec.secret || !set ? null : '100.64.0.1',
        outer,
        sessions: spec.places.includes('sessions') ? (set ? 'same' : 'none') : null,
        required: false,
      }
    }),
    sessionsPending: mode === 'pending',
  }
}

/** `stats/tally`: a host with `unreachable` in it is refused as the service's check would; the fields go into the variables. */
export function fakeTally(state: EvenKeelState, body: Record<string, unknown>): EvenKeelState {
  const mode = body.mode as TallyMode
  const server = body.server as Record<string, string> | null | undefined
  if (mode !== 'server' || server === null || server === undefined) return { ...state, tally: mode }
  const address = `${server.host}:${server.port || '5432'}`
  if (server.host!.includes('unreachable')) throw fail('tally.unreachable', { role: 'tally_reader', address }, { detail: `connect ETIMEDOUT ${address}` })
  const values: Record<string, string | undefined> = {
    TALLY_DB_HOST: server.host,
    TALLY_DB_PORT: server.port || '5432',
    TALLY_DB_NAME: server.name,
    TALLY_READER_PASSWORD: server.readerPassword,
    TALLY_WRITER_PASSWORD: server.writerPassword,
  }
  const variables = state.secrets.variables.map((each) => {
    const value = values[each.name]
    return value ? { ...each, set: true, value: each.secret ? null : value } : each
  })
  return { ...state, tally: mode, secrets: { ...state.secrets, variables } }
}

export function fakeSecretsCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('secrets/')) return null
  const variable = String(body.name)
  if (variable === 'EVEN_KEEL_TOKEN' && name === 'secrets/set' && String(body.value).length < 16) throw fail('config.tokenShape', {})
  const set = name === 'secrets/set'
  const variables = state.secrets.variables.map((each) =>
    each.name !== variable
      ? each
      : { ...each, set, value: each.secret || !set ? null : String(body.value), sessions: each.sessions === null ? null : set ? ('same' as const) : ('none' as const) },
  )
  return { ...state, secrets: { ...state.secrets, variables, sessionsPending: state.secrets.sessionsPending || (!set && variables.some((each) => each.name === variable && each.places.includes('sessions'))) } }
}
