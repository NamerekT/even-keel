import { describe, expect, it } from 'vitest'
import { GitlabApi } from './api.js'
import { fakeFetch } from './fixture.js'

describe('GitLab REST pagination', () => {
  it('continues a full page when a proxy removes pagination headers', async () => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id }))
    const fake = fakeFetch([{ body: rows }, { body: [{ id: 100 }] }])
    expect(await new GitlabApi('https://gitlab.example.com', 'example', 1000, fake.fetch).collect('/projects')).toHaveLength(101)
    expect(fake.calls[1]!.url).toContain('page=2')
  })

  it('rejects repeated or nonnumeric page values without following external URLs', async () => {
    for (const next of ['1', 'https://elsewhere.example.com/']) {
      const fake = fakeFetch([{ body: [], next }])
      await expect(new GitlabApi('https://gitlab.example.com', 'example', 1000, fake.fetch).collect('/projects')).rejects.toThrow('pagination')
      expect(fake.calls).toHaveLength(1)
    }
  })
})
