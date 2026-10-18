import { describe, expect, it } from 'vitest'
import { isSecret, secretCatalog } from './catalog.js'

describe('secretCatalog', () => {
  const catalog = secretCatalog()
  const spec = (name: string) => catalog.find((each) => each.name === name)

  it('writes Tally and the page token only into .env', () => {
    expect(spec('TALLY_WRITER_PASSWORD')?.places).toEqual(['env'])
    expect(spec('EVEN_KEEL_TOKEN')?.places).toEqual(['env'])
  })

  it('names each variable\'s readers', () => {
    expect(spec('TALLY_DB_HOST')?.readers).toEqual({ tally: true, page: false })
    expect(spec('EVEN_KEEL_TOKEN')?.readers.page).toBe(true)
  })

  it('has no tracker or CI variable: those are the profiles\', and keeps Tally first, then the page', () => {
    expect(spec('GITHUB_TOKEN')).toBeUndefined()
    expect(spec('HULY_PASSWORD')).toBeUndefined()
    expect(spec('FORGEJO_TOKEN')).toBeUndefined()
    expect(catalog[0]?.name).toBe('TALLY_DB_HOST')
    expect(catalog.at(-1)?.name).toBe('EVEN_KEEL_TOKEN')
  })
})

describe('isSecret', () => {
  it('shows an address, a workspace, a login, a port or a model, and hides everything else', () => {
    for (const name of ['HULY_URL', 'HULY_WORKSPACE', 'HULY_EMAIL', 'TALLY_DB_HOST', 'TALLY_DB_PORT', 'TALLY_DB_NAME', 'TALLY_LLM_MODEL']) expect(isSecret(name)).toBe(false)
    for (const name of ['HULY_PASSWORD', 'GITHUB_TOKEN', 'TALLY_LLM_KEY', 'EVEN_KEEL_TOKEN', 'SOME_NEW_VARIABLE']) expect(isSecret(name)).toBe(true)
  })
})
