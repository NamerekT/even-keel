import { fail } from '../../../src/notice/notice.js'
import { secretCatalog } from '../../../src/secrets/catalog.js'
import type { EvenKeelState, SecretsView } from '../../../src/state.js'

const ADAPTERS = {
  huly: { variables: ['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'HULY_PASSWORD'] },
  github: { variables: ['GITHUB_TOKEN'] },
  linear: { variables: ['LINEAR_TOKEN'] },
}
const PLAIN: Record<string, string> = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_EMAIL: 'john.doe@example.com' }
const SET = new Set([...Object.keys(PLAIN), 'HULY_PASSWORD', 'FORGEJO_TOKEN'])

/**
 * The "Access" tab: Huly and the Forgejo token set, the rest not. `?secrets=` adds `outer` — `TALLY_DB_HOST` from the
 * service's environment, `stale` — the sessions' settings hold another Huly password, `pending` — a removal waits.
 */
export function fakeSecrets(mode: string | null): SecretsView {
  return {
    variables: secretCatalog(ADAPTERS, { forgejo: 'FORGEJO_TOKEN', github: 'GITHUB_TOKEN' }).map((spec) => {
      const outer = mode === 'outer' && spec.name === 'TALLY_DB_HOST'
      const set = SET.has(spec.name) || outer
      return {
        ...spec,
        set,
        value: spec.secret || !set ? null : (PLAIN[spec.name] ?? '100.64.0.1'),
        outer,
        sessions: !spec.places.includes('sessions') ? null : !set ? 'none' : mode === 'stale' && spec.name === 'HULY_PASSWORD' ? 'other' : 'same',
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
  return { ...state, secrets: { variables, sessionsPending: state.secrets.sessionsPending || (!set && variables.some((each) => each.name === variable && each.places.includes('sessions'))) } }
}
