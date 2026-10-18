import { describe, expect, it } from 'vitest'
import { isSecret, secretCatalog } from './catalog.js'

const adapters = {
  huly: { title: 'Huly', variables: ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD'] },
  github: { title: 'GitHub', variables: ['GITHUB_TOKEN'] },
}
const ciTokens = { forgejo: 'FORGEJO_TOKEN', github: 'GITHUB_TOKEN' } as const

describe('secretCatalog', () => {
  const catalog = secretCatalog(adapters, ciTokens)
  const spec = (name: string) => catalog.find((each) => each.name === name)

  it('writes a tracker key into .env and into the sessions’ settings, a CI token and Tally only into .env', () => {
    expect(spec('HULY_PASSWORD')?.places).toEqual(['env', 'sessions'])
    expect(spec('FORGEJO_TOKEN')?.places).toEqual(['env'])
    expect(spec('TALLY_WRITER_PASSWORD')?.places).toEqual(['env'])
    expect(spec('EVEN_KEEL_TOKEN')?.places).toEqual(['env'])
  })

  it('lists a variable once with every reader: the GitHub token serves the tracker and GitHub Actions', () => {
    expect(catalog.filter((each) => each.name === 'GITHUB_TOKEN')).toHaveLength(1)
    expect(spec('GITHUB_TOKEN')).toMatchObject({ places: ['env', 'sessions'], readers: { trackers: ['github'], ci: ['github'] } })
    expect(spec('FORGEJO_TOKEN')?.readers).toEqual({ trackers: [], ci: ['forgejo'], tally: false, page: false })
    expect(spec('TALLY_DB_HOST')?.readers.tally).toBe(true)
    expect(spec('EVEN_KEEL_TOKEN')?.readers.page).toBe(true)
  })

  it('keeps the trackers first, in the adapters’ order, then the CI, Tally and the page', () => {
    expect(catalog.map((each) => each.name).slice(0, 5)).toEqual(['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD', 'GITHUB_TOKEN', 'FORGEJO_TOKEN'])
    expect(catalog.at(-1)?.name).toBe('EVEN_KEEL_TOKEN')
  })
})

describe('isSecret', () => {
  it('shows an address, a workspace, a login, a port or a model, and hides everything else', () => {
    for (const name of ['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'TALLY_DB_HOST', 'TALLY_DB_PORT', 'TALLY_DB_NAME', 'TALLY_LLM_MODEL']) expect(isSecret(name)).toBe(false)
    for (const name of ['HULY_PASSWORD', 'GITHUB_TOKEN', 'TALLY_LLM_KEY', 'EVEN_KEEL_TOKEN', 'SOME_NEW_VARIABLE']) expect(isSecret(name)).toBe(true)
  })
})
