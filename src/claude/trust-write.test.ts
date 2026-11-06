import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
})
