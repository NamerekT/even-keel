/**
 * Where a variable is written: Even Keel's `.env`, and the `env` of the global `~/.claude/settings.json` sessions read at
 * their start. Packages read the same `.env` through the MCP gateway; a key they should get apart from Even Keel's own
 * would be a variable of its own named in the adapter's `mcpKeys` (`docs/settings.md`).
 */
export type SecretPlace = 'env' | 'sessions'

/** The parts of the service that read the variable. */
export interface SecretReaders {
  tally: boolean
  /** `EVEN_KEEL_TOKEN`: the page's own access token. */
  page: boolean
}

export interface SecretSpec {
  name: string
  /** A secret's value never leaves the service; the others are shown as they are. */
  secret: boolean
  places: SecretPlace[]
  readers: SecretReaders
}

/** The variables of Tally (`tally/`) a user sets: its own Postgres and the classifier. */
const TALLY = [
  'TALLY_DB_HOST',
  'TALLY_DB_PORT',
  'TALLY_DB_NAME',
  'TALLY_WRITER_PASSWORD',
  'TALLY_READER_PASSWORD',
  'TALLY_LLM_URL',
  'TALLY_LLM_KEY',
  'TALLY_LLM_MODEL',
]
export const PAGE_TOKEN = 'EVEN_KEEL_TOKEN'
const PLAIN = /_(URL|WORKSPACE|EMAIL|HOST|PORT|NAME|MODEL)$/

/** A name that does not say it holds an address or a login is taken for a secret. */
export const isSecret = (name: string): boolean => !PLAIN.test(name)

/**
 * The `.env` credentials the page's "Access" tab offers: Tally's and the page token, each once with all its readers. The
 * trackers' and the CIs' credentials are their profiles' (`src/profiles/`), not variables.
 */
export function secretCatalog(): SecretSpec[] {
  const specs = new Map<string, SecretSpec>()
  const add = (name: string, places: SecretPlace[]): SecretReaders => {
    const spec = specs.get(name) ?? { name, secret: isSecret(name), places: [], readers: { tally: false, page: false } }
    for (const place of places) if (!spec.places.includes(place)) spec.places.push(place)
    specs.set(name, spec)
    return spec.readers
  }
  for (const name of TALLY) add(name, ['env']).tally = true
  add(PAGE_TOKEN, ['env']).page = true
  return [...specs.values()]
}
