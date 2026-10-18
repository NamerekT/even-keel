import { describe, expect, it } from 'vitest'
import { isSecret, secretCatalog } from './catalog.js'

describe('secretCatalog', () => {
  const catalog = secretCatalog({ forgejo: 'FORGEJO_TOKEN' })
  const spec = (name: string) => catalog.find((each) => each.name === name)

  it('writes a CI token, Tally and the page token only into .env', () => {
    expect(spec('FORGEJO_TOKEN')?.places).toEqual(['env'])
    expect(spec('TALLY_WRITER_PASSWORD')?.places).toEqual(['env'])
    expect(spec('EVEN_KEEL_TOKEN')?.places).toEqual(['env'])
  })

  it('names each variable\'s readers', () => {
    expect(spec('FORGEJO_TOKEN')?.readers).toEqual({ ci: ['forgejo'], tally: false, page: false })
    expect(spec('TALLY_DB_HOST')?.readers.tally).toBe(true)
    expect(spec('EVEN_KEEL_TOKEN')?.readers.page).toBe(true)
  })

  it('has no tracker variable: those are the profiles\', and keeps the CI first, then Tally and the page', () => {
    expect(spec('GITHUB_TOKEN')).toBeUndefined()
    expect(spec('HULY_PASSWORD')).toBeUndefined()
    expect(catalog[0]?.name).toBe('FORGEJO_TOKEN')
    expect(catalog.at(-1)?.name).toBe('EVEN_KEEL_TOKEN')
  })
})

describe('isSecret', () => {
  it('shows an address, a workspace, a login, a port or a model, and hides everything else', () => {
    for (const name of ['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'TALLY_DB_HOST', 'TALLY_DB_PORT', 'TALLY_DB_NAME', 'TALLY_LLM_MODEL']) expect(isSecret(name)).toBe(false)
    for (const name of ['HULY_PASSWORD', 'GITHUB_TOKEN', 'TALLY_LLM_KEY', 'EVEN_KEEL_TOKEN', 'SOME_NEW_VARIABLE']) expect(isSecret(name)).toBe(true)
  })
})
