import { stat, readdir } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { TrackerProfile } from '../profiles/model.js'
import { projectTargets } from './adapters.js'

vi.mock('node:fs/promises', () => ({ stat: vi.fn(), readdir: vi.fn() }))

describe('projectTargets', () => {
  const git = async () => ({ code: 0, out: 'remote.origin.url git@git.example.com:group/sub/app.git' })
  const profile: TrackerProfile = { id: 'lab', kind: 'gitlab', name: 'Example GitLab', isDefault: true, values: { GITLAB_URL: 'https://git.example.com', GITLAB_TOKEN: 'fake-token' }, login: null, expiresAt: null }

  it('requires a root .gitlab-ci.yml file and reads GitLab hosts again from the current profiles', async () => {
    vi.mocked(readdir).mockResolvedValue([])
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>)
    expect(await projectTargets(git, 'example')).toEqual([])
    expect(await projectTargets(git, 'example', [profile])).toEqual([
      { kind: 'gitlab', remote: 'origin', web: 'https://git.example.com', owner: 'group/sub', repo: 'app' },
    ])
    expect(String(vi.mocked(stat).mock.calls[0]![0]).replaceAll('\\', '/')).toBe('example/.gitlab-ci.yml')
    vi.mocked(stat).mockResolvedValue({ isFile: () => false } as Awaited<ReturnType<typeof stat>>)
    expect(await projectTargets(git, 'example', [profile])).toEqual([])
    vi.mocked(stat).mockRejectedValue(new Error('missing'))
    expect(await projectTargets(git, 'example', [profile])).toEqual([])
  })
})
