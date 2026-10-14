import { describe, expect, it } from 'vitest'
import { compareVersions, releaseOf, repositoryOf, updatesView } from './release.js'

const ON = { check: true, notify: true, dismissed: null }
const RELEASE = { version: '0.2.0', url: 'https://github.com/octo-org/app/releases/tag/v0.2.0' }

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
  const answer = { tag_name: 'v0.2.0', html_url: RELEASE.url, draft: false, prerelease: false }

  it('reads the version from the tag and the page of the release', () => {
    expect(releaseOf(answer, 'octo-org/app')).toEqual(RELEASE)
  })

  it('falls back to the releases page without the release url', () => {
    expect(releaseOf({ ...answer, html_url: undefined }, 'octo-org/app')).toEqual({ version: '0.2.0', url: 'https://github.com/octo-org/app/releases' })
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
  it('shows the toast for a newer release', () => {
    expect(updatesView('0.1.0', RELEASE, ON)).toEqual({ current: '0.1.0', available: RELEASE, toast: true })
  })

  it('shows nothing for a release that is not newer', () => {
    expect(updatesView('0.2.0', RELEASE, ON)).toEqual({ current: '0.2.0', available: null, toast: false })
    expect(updatesView('0.3.0', RELEASE, ON).available).toBeNull()
    expect(updatesView('0.1.0', null, ON)).toEqual({ current: '0.1.0', available: null, toast: false })
  })

  it('keeps the mark but not the toast for a version closed or with toasts off', () => {
    expect(updatesView('0.1.0', RELEASE, { ...ON, dismissed: '0.2.0' })).toEqual({ current: '0.1.0', available: RELEASE, toast: false })
    expect(updatesView('0.1.0', RELEASE, { ...ON, notify: false })).toEqual({ current: '0.1.0', available: RELEASE, toast: false })
  })

  it('shows the toast again for a version after the closed one', () => {
    expect(updatesView('0.1.0', RELEASE, { ...ON, dismissed: '0.1.5' }).toast).toBe(true)
  })

  it('shows nothing with the check off', () => {
    expect(updatesView('0.1.0', RELEASE, { ...ON, check: false })).toEqual({ current: '0.1.0', available: null, toast: false })
  })
})
