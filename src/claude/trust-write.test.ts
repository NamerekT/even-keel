import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { linkType } from '../account/share.js'
import { noticeOf } from '../notice/notice.js'
import { trustFolder } from './trust.js'

const folders: string[] = []
const file = () => {
  const folder = mkdtempSync(join(tmpdir(), 'ek-trust-'))
  folders.push(folder)
  return join(folder, '.claude.json')
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('trustFolder', () => {
  it('creates missing config and preserves existing fields on a repeated write', () => {
    const target = file()
    trustFolder(target, 'D:\\repo', 'win32')
    const first = JSON.parse(readFileSync(target, 'utf8'))
    expect(first).toEqual({ projects: { 'D:/repo': { hasTrustDialogAccepted: true } } })
    const text = JSON.stringify({ keep: 4, projects: { 'd:/REPO': { keep: 7 }, other: { keep: 8 } } })
    writeFileSync(target, text)
    trustFolder(target, 'D:/repo', 'win32')
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ keep: 4, projects: { 'd:/REPO': { keep: 7, hasTrustDialogAccepted: true }, other: { keep: 8 } } })
    const trusted = readFileSync(target, 'utf8')
    trustFolder(target, 'D:/repo', 'win32')
    expect(readFileSync(target, 'utf8')).toBe(trusted)
  })

  it.each(['', '{broken', 'null', '[]', '{"projects":[]}', '{"projects":{"D:/repo":null}}'])('preserves damaged config: %s', (text) => {
    const target = file()
    writeFileSync(target, text)
    let thrown: unknown
    try { trustFolder(target, 'D:/repo', 'win32') } catch (error) { thrown = error }
    expect(noticeOf(thrown)).toMatchObject({ code: 'claude.trustWriteFailed', params: { folder: 'D:/repo', file: target, reason: 'invalid' } })
    expect(readFileSync(target, 'utf8')).toBe(text)
  })

  it('reports an unreadable config as a recoverable trust error, naming the file', () => {
    const target = file()
    mkdirSync(target)
    try { trustFolder(target, 'D:/repo', 'win32') } catch (error) {
      expect(noticeOf(error)).toMatchObject({ code: 'claude.trustWriteFailed', params: { folder: 'D:/repo', file: target, reason: 'access' } })
      return
    }
    throw new Error('Expected trust failure')
  })

  it.each([true, false])('copies a legacy Windows entry without changing it (trusted: %s)', (hasTrustDialogAccepted) => {
    const target = file()
    const legacy = { keep: { nested: 7 }, hasTrustDialogAccepted }
    writeFileSync(target, JSON.stringify({ keep: 4, projects: { 'd:\\REPO': legacy, other: { keep: 8 } } }))
    trustFolder(target, 'D:\\repo', 'win32')
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ keep: 4, projects: {
      'd:\\REPO': legacy, 'D:/repo': { ...legacy, hasTrustDialogAccepted: true }, other: { keep: 8 },
    } })
    const trusted = readFileSync(target, 'utf8')
    trustFolder(target, 'D:\\repo', 'win32')
    expect(readFileSync(target, 'utf8')).toBe(trusted)
  })

  it('updates only the CLI key when a legacy entry already trusts the folder', () => {
    const target = file()
    const projects = { 'd:\\repo': { hasTrustDialogAccepted: true, legacy: 1 }, 'D:/repo': { hasTrustDialogAccepted: false, keep: 2 } }
    const text = JSON.stringify({ projects })
    writeFileSync(target, text)
    trustFolder(target, 'D:\\repo', 'win32')
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ projects: { ...projects, 'D:/repo': { hasTrustDialogAccepted: true, keep: 2 } } })
    trustFolder(target, 'D:/repo-other', 'win32')
    expect(JSON.parse(readFileSync(target, 'utf8')).projects['D:/repo-other'].hasTrustDialogAccepted).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf8')).projects).not.toHaveProperty('D:/')
  })

  it.each(['linux', 'darwin'] as const)('keeps existing trust behaviour on %s', (platform) => {
    const target = file()
    const folder = '/repo\\name'
    trustFolder(target, folder, platform)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ projects: { [folder]: { hasTrustDialogAccepted: true } } })
    const text = readFileSync(target, 'utf8')
    trustFolder(target, folder, platform)
    expect(readFileSync(target, 'utf8')).toBe(text)
  })

  // The CLI looks trust up by its working folder's real path: getcwd resolves links (EKR-94).
  const linked = () => {
    const root = mkdtempSync(join(tmpdir(), 'ek-trust-link-'))
    folders.push(root)
    const repo = join(root, 'repo')
    mkdirSync(repo)
    const link = join(root, 'link')
    symlinkSync(repo, link, linkType(process.platform))
    return { repo: realpathSync.native(repo), link }
  }

  it('writes the real path of a linked folder on Linux, carrying the entry the link had', () => {
    const target = file()
    const { repo, link } = linked()
    writeFileSync(target, JSON.stringify({ projects: { [link]: { keep: 3 } } }))
    trustFolder(target, link, 'linux')
    expect(JSON.parse(readFileSync(target, 'utf8')).projects).toEqual({ [link]: { keep: 3 }, [repo]: { keep: 3, hasTrustDialogAccepted: true } })
    const text = readFileSync(target, 'utf8')
    trustFolder(target, link, 'linux')
    expect(readFileSync(target, 'utf8')).toBe(text)
  })

  it('does not count trust under the link path as trust on Linux', () => {
    const target = file()
    const { repo, link } = linked()
    writeFileSync(target, JSON.stringify({ projects: { [link]: { hasTrustDialogAccepted: true } } }))
    trustFolder(target, link, 'linux')
    expect(JSON.parse(readFileSync(target, 'utf8')).projects[repo]).toEqual({ hasTrustDialogAccepted: true })
  })

  it('writes a missing folder as it is on Linux', () => {
    const target = file()
    const folder = join(tmpdir(), 'ek-trust-missing', 'repo')
    trustFolder(target, folder, 'linux')
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ projects: { [folder]: { hasTrustDialogAccepted: true } } })
  })
})
