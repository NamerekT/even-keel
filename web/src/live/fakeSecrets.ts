import { fail } from '../../../src/notice/notice.js'
import { secretCatalog } from '../../../src/secrets/catalog.js'
import type { EvenKeelState, SecretsView } from '../../../src/state.js'

const SET = new Set(['FORGEJO_TOKEN', 'TALLY_DB_HOST'])

/**
 * The "Access" tab's keys besides the trackers' profiles: the Forgejo token and Tally's host set, the rest not.
 * `?secrets=` adds `outer` — `TALLY_DB_HOST` from the service's environment, `pending` — a removal waits.
 */
export function fakeSecrets(mode: string | null): SecretsView {
  return {
    variables: secretCatalog({ forgejo: 'FORGEJO_TOKEN' }).map((spec) => {
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
