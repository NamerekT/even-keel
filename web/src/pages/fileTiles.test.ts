import { expect, it, vi } from 'vitest'
import { ATTACH_SOURCES, sheetSources, shortStem, syncUrls, tileOf } from './fileTiles.js'

const file = (name: string, type = '') => new File(['x'], name, { type })

it('shows a picture and a video by their type or extension, anything else as a file with its extension', () => {
  expect(tileOf(file('shot.png', 'image/png'))).toEqual({ kind: 'image', ext: 'PNG', stem: 'shot' })
  expect(tileOf(file('clip.mp4'))).toEqual({ kind: 'video', ext: 'MP4', stem: 'clip' })
  expect(tileOf(file('notes.tar.gz'))).toEqual({ kind: 'file', ext: 'GZ', stem: 'notes.tar' })
  expect(tileOf(file('Makefile'))).toEqual({ kind: 'file', ext: '', stem: 'Makefile' })
  expect(tileOf(file('.env'))).toEqual({ kind: 'file', ext: '', stem: '.env' })
})

it('keeps a short name whole and cuts a long one in the middle, so its end stays', () => {
  expect(shortStem('report', 12)).toBe('report')
  expect(shortStem('Screenshot_20261119-175844', 12)).toBe('Screen…75844')
  expect(shortStem('abcdefghijklm', 12)).toHaveLength(12)
})

it('makes a URL for each new picture once, revokes the URLs of removed files and makes none for other files', () => {
  const urls = new Map<File, string>()
  const create = vi.fn((each: File) => `blob:${each.name}`)
  const revoke = vi.fn()
  const one = file('one.png')
  const two = file('two.mp4')
  const doc = file('doc.pdf')
  expect(syncUrls(urls, [one, two, doc], create, revoke)).toBe(true)
  expect([...urls.values()]).toEqual(['blob:one.png', 'blob:two.mp4'])
  expect(syncUrls(urls, [one, two, doc], create, revoke)).toBe(false)
  expect(create).toHaveBeenCalledTimes(2)
  expect(syncUrls(urls, [two], create, revoke)).toBe(true)
  expect(revoke).toHaveBeenCalledWith('blob:one.png')
  expect([...urls.keys()]).toEqual([two])
  syncUrls(urls, [], create, revoke)
  expect(revoke).toHaveBeenCalledWith('blob:two.mp4')
  expect(urls.size).toBe(0)
})

it('opens the camera, the gallery of photos and videos, and any file', () => {
  expect(ATTACH_SOURCES).toEqual([
    { id: 'camera', accept: 'image/*', capture: 'environment', multiple: false },
    { id: 'photos', accept: 'image/*,video/*', multiple: true },
    { id: 'files', multiple: true },
  ])
})

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1'

it('gives Files of the sheet a generic type in Chromium on Android, so it opens the file manager without the camera', () => {
  const files = sheetSources(ANDROID_CHROME).find((source) => source.id === 'files')
  expect(files).toEqual({ id: 'files', accept: 'application/octet-stream', multiple: true })
  expect(sheetSources(ANDROID_CHROME).filter((source) => source.id !== 'files')).toEqual(ATTACH_SOURCES.filter((source) => source.id !== 'files'))
})

it('leaves the sheet as it is outside Chromium on Android', () => {
  expect(sheetSources(ANDROID_FIREFOX)).toEqual(ATTACH_SOURCES)
  expect(sheetSources(IPHONE_CHROME)).toEqual(ATTACH_SOURCES)
  expect(sheetSources('')).toEqual(ATTACH_SOURCES)
})
