import { kindOf } from './Attachments.js'

/** What a file of the chat field is drawn as: a picture or a video by its preview, any other file by its extension and name. */
export interface FileTile {
  kind: 'image' | 'video' | 'file'
  /** Upper case, empty for a name without one. */
  ext: string
  stem: string
}

export function tileOf(file: File): FileTile {
  const dot = file.name.lastIndexOf('.')
  const split = dot > 0 && dot < file.name.length - 1
  return {
    kind: kindOf({ type: file.type, name: file.name }),
    ext: split ? file.name.slice(dot + 1).toUpperCase() : '',
    stem: split ? file.name.slice(0, dot) : file.name,
  }
}

/** A name cut to `max` characters in its middle: a screenshot's start and its time at the end both stay. */
export function shortStem(stem: string, max: number): string {
  if (stem.length <= max) return stem
  const head = Math.ceil((max - 1) / 2)
  return `${stem.slice(0, head)}…${stem.slice(stem.length - (max - 1 - head))}`
}

/**
 * Brings `urls` in line with `files`: a new picture or video gets its object URL, a file gone from the list has its
 * URL revoked. Answers whether anything changed.
 */
export function syncUrls(urls: Map<File, string>, files: readonly File[], create: (file: File) => string, revoke: (url: string) => void): boolean {
  let changed = false
  const kept = new Set(files)
  for (const [file, url] of urls) {
    if (kept.has(file)) continue
    revoke(url)
    urls.delete(file)
    changed = true
  }
  for (const file of files) {
    if (urls.has(file) || tileOf(file).kind === 'file') continue
    urls.set(file, create(file))
    changed = true
  }
  return changed
}

export type AttachSourceId = 'camera' | 'photos' | 'files'

/** A tile of the phone's attach menu and the file input behind it. */
export interface AttachSource {
  id: AttachSourceId
  accept?: string
  capture?: 'environment'
  multiple: boolean
}

/**
 * The camera at once; the system gallery (Android's photo picker, iOS Photos), which a file input opens for pictures
 * and videos without `capture`; any file, as the desktop's "+".
 */
export const ATTACH_SOURCES: readonly AttachSource[] = [
  { id: 'camera', accept: 'image/*', capture: 'environment', multiple: false },
  { id: 'photos', accept: 'image/*,video/*', multiple: true },
  { id: 'files', multiple: true },
]

/**
 * The sheet's tiles for a browser. Chromium on Android (`SelectFileDialog`) adds Camera and Camera Video to its chooser
 * when `accept` is empty or names an image or video type, so the sheet's Files gets `application/octet-stream`: that
 * type names neither, and as Chromium's "generic" type it lifts every filter of the file manager, so pictures and
 * videos stay pickable there. Firefox on Android would filter by it, and other browsers are not checked: they keep
 * the plain input.
 */
export function sheetSources(userAgent: string): readonly AttachSource[] {
  if (!/Android/.test(userAgent) || !/Chrome\//.test(userAgent)) return ATTACH_SOURCES
  return ATTACH_SOURCES.map((source) => (source.id === 'files' ? { ...source, accept: 'application/octet-stream' } : source))
}
