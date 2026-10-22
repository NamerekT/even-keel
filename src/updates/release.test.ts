import { describe, expect, it } from 'vitest'
import { compareVersions, releaseOf, releasesOf, repositoryOf, revertedOf, updatesView, type ReleaseNote } from './release.js'

const ON = { check: true, notify: true, dismissed: null }
const RELEASE = { version: '0.2.0', tag: 'v0.2.0', url: 'https://github.com/octo-org/app/releases/tag/v0.2.0' }
const NOTE: ReleaseNote = { ...RELEASE, body: '### Added\n\n- A button', reverted: null }

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
  })

  it('puts a prerelease before its release', () => {
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('0.2.0-alpha', '0.2.0-beta')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta', '0.2.0-beta.1')).toBeLessThan(0)
  })

  it('takes a tag with a leading v and ignores build metadata', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0+build.5', '0.2.0')).toBe(0)
  })

  it('returns null for what is not a version', () => {
    expect(compareVersions('latest', '0.1.0')).toBeNull()
    expect(compareVersions('0.2', '0.1.0')).toBeNull()
  })
})

describe('releaseOf', () => {
  const answer = { tag_name: 'v0.2.0', html_url: RELEASE.url, draft: false, prerelease: false, body: '### Added\r\n\r\n- A button\r\n' }

  it('reads the version from the tag, the page of the release and its notes', () => {
    expect(releaseOf(answer, 'octo-org/app')).toEqual(NOTE)
  })

  it('falls back to the releases page without the release url, and to no notes', () => {
    expect(releaseOf({ ...answer, html_url: undefined, body: null }, 'octo-org/app')).toEqual({
      version: '0.2.0',
      tag: 'v0.2.0',
      url: 'https://github.com/octo-org/app/releases',
      body: '',
      reverted: null,
    })
  })

  it('reads what a revert release reverts', () => {
    const body = '### Fixed\n\n- A crash\n\n### Reverted\n\n- The button of 0.2.0: it lost tasks\n\n## Thanks'
    expect(releaseOf({ ...answer, body }, 'octo-org/app')?.reverted).toBe('- The button of 0.2.0: it lost tasks')
  })

  it('does not count drafts, prereleases and tags that are not versions', () => {
    expect(releaseOf({ ...answer, draft: true }, 'octo-org/app')).toBeNull()
    expect(releaseOf({ ...answer, prerelease: true }, 'octo-org/app')).toBeNull()
    expect(releaseOf({ ...answer, tag_name: 'v0.2.0-rc.1' }, 'octo-org/app')).toBeNull()
    expect(releaseOf({ ...answer, tag_name: 'nightly' }, 'octo-org/app')).toBeNull()
    expect(releaseOf({ message: 'Not Found' }, 'octo-org/app')).toBeNull()
    expect(releaseOf(null, 'octo-org/app')).toBeNull()
  })
})

describe('releasesOf', () => {
  const release = (tag: string, extra: object = {}) => ({ tag_name: tag, html_url: `https://example.com/${tag}`, body: '', ...extra })

  it('keeps the published releases, newest first', () => {
    const answer = [release('v0.2.0'), release('v0.10.0'), release('v0.3.0', { draft: true }), release('v0.4.0-rc.1'), release('v0.9.1')]
    expect(releasesOf(answer, 'octo-org/app').map((item) => item.version)).toEqual(['0.10.0', '0.9.1', '0.2.0'])
  })

  it('takes nothing from an answer that is not a list', () => {
    expect(releasesOf({ message: 'Not Found' }, 'octo-org/app')).toEqual([])
  })
})

describe('revertedOf', () => {
  it('reads the section up to the next heading of its level or higher', () => {
    expect(revertedOf('### Reverted\n- a\n#### Detail\n- b\n### Fixed\n- c')).toBe('- a\n#### Detail\n- b')
    expect(revertedOf('## 0.2.1\n### reverted ##\n\n- a\n')).toBe('- a')
  })

  it('marks a release with an empty section, and none without one', () => {
    expect(revertedOf('### Reverted\n### Fixed\n- c')).toBe('')
    expect(revertedOf('### Fixed\n- Reverted the button')).toBeNull()
    expect(revertedOf('')).toBeNull()
  })
})

describe('repositoryOf', () => {
  it('reads owner/name of a GitHub repository in every form npm takes', () => {
    expect(repositoryOf({ type: 'git', url: 'git+https://github.com/octo-org/app.git' })).toBe('octo-org/app')
    expect(repositoryOf('https://github.com/octo-org/app')).toBe('octo-org/app')
    expect(repositoryOf('git@github.com:octo-org/app.git')).toBe('octo-org/app')
    expect(repositoryOf('github:octo-org/app')).toBe('octo-org/app')
    expect(repositoryOf('octo-org/app')).toBe('octo-org/app')
  })

  it('returns null for a repository elsewhere or none', () => {
    expect(repositoryOf({ url: 'https://gitlab.com/octo-org/app.git' })).toBeNull()
    expect(repositoryOf(undefined)).toBeNull()
    expect(repositoryOf('')).toBeNull()
  })
})

describe('updatesView', () => {
  const OLDER: ReleaseNote = { version: '0.1.5', tag: 'v0.1.5', url: 'https://example.com/v0.1.5', body: '- Fixes', reverted: null }
  const OLDEST: ReleaseNote = { ...OLDER, version: '0.1.0', tag: 'v0.1.0' }
  const RELEASES = [NOTE, OLDER, OLDEST]

  it('shows the toast for a newer release', () => {
    expect(updatesView('0.1.5', RELEASES, ON)).toEqual({ current: '0.1.5', available: RELEASE, toast: true, notes: [NOTE] })
  })

  it('gives the notes of every release between the installed version and the latest, newest first', () => {
    expect(updatesView('0.1.0', RELEASES, ON).notes).toEqual([NOTE, OLDER])
  })

  it('shows nothing for a release that is not newer', () => {
    expect(updatesView('0.2.0', RELEASES, ON)).toEqual({ current: '0.2.0', available: null, toast: false, notes: [] })
    expect(updatesView('0.3.0', RELEASES, ON).available).toBeNull()
    expect(updatesView('0.1.0', [], ON)).toEqual({ current: '0.1.0', available: null, toast: false, notes: [] })
  })

  it('keeps the mark but not the toast for a version closed or with toasts off', () => {
    expect(updatesView('0.1.5', RELEASES, { ...ON, dismissed: '0.2.0' })).toMatchObject({ available: RELEASE, toast: false })
    expect(updatesView('0.1.5', RELEASES, { ...ON, notify: false })).toMatchObject({ available: RELEASE, toast: false })
  })

  it('shows the toast again for a version after the closed one', () => {
    expect(updatesView('0.1.0', RELEASES, { ...ON, dismissed: '0.1.5' }).toast).toBe(true)
  })

  it('shows nothing with the check off', () => {
    expect(updatesView('0.1.0', RELEASES, { ...ON, check: false })).toEqual({ current: '0.1.0', available: null, toast: false, notes: [] })
  })
})
