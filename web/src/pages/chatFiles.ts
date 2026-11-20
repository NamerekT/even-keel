/** The part of a `DataTransferItem` the chat reads: a pasted or dropped entry. */
export interface TransferItem {
  kind: string
  getAsFile(): File | null
  webkitGetAsEntry?(): { isDirectory: boolean } | null
}

const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', 'svg+xml': 'svg' }

/** A drag that brings files from outside the page: their types include `Files`. */
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes('Files')
}

/**
 * The files of a paste or a drop, without folders, links and text. A picture pasted from the clipboard comes as
 * `image.png` whatever it is: it is named after the moment of the paste, so different pastes do not merge into
 * `image (2).png` and the feed shows it was a paste. A drop passes no moment: its files are on disk under their own names.
 */
export function takenFiles(items: Iterable<TransferItem>, pastedAt: Date | null): File[] {
  return [...items].flatMap((item) => {
    if (item.kind !== 'file' || item.webkitGetAsEntry?.()?.isDirectory === true) return []
    const file = item.getAsFile()
    if (file === null) return []
    const name = pastedAt === null ? file.name : pastedName(file, pastedAt)
    return [name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified })]
  })
}

export function pastedName(file: File, now: Date): string {
  const type = /^image\/(.+)$/.exec(file.type)?.[1]
  if (type === undefined || !/^image\.\w+$/i.test(file.name)) return file.name
  return pictureName(type, now)
}

function pictureName(subtype: string, now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `paste-${stamp}.${EXTENSIONS[subtype] ?? subtype}`
}

/** The part of a `ClipboardItem` the chat reads. */
export interface ClipboardEntry {
  types: readonly string[]
  getType(type: string): Promise<Blob>
}

export type ClipboardPictures = { files: File[] } | { problem: 'empty' | 'denied' }

/**
 * The pictures of the clipboard, read through the async clipboard API: the way in for a phone keyboard, whose clipboard
 * panel cannot paste a picture into a `<textarea>`. `read` is called before anything awaits, so it stays within the
 * press that asked for it, as Safari and Chrome require. A refusal — the permission, or no focus — is `denied`.
 */
export async function clipboardPictures(clipboard: { read(): Promise<ClipboardEntry[]> }, now: Date): Promise<ClipboardPictures> {
  let files: File[]
  try {
    const items = await clipboard.read()
    files = await Promise.all(
      items.flatMap((item) => {
        const type = item.types.find((one) => one.startsWith('image/'))
        if (type === undefined) return []
        return [item.getType(type).then((blob) => new File([blob], pictureName(type.slice('image/'.length), now), { type }))]
      }),
    )
  } catch {
    return { problem: 'denied' }
  }
  return files.length > 0 ? { files } : { problem: 'empty' }
}

/** The async clipboard read, where the browser has it: HTTPS or localhost, and not every browser. */
export function clipboardReader(): { read(): Promise<ClipboardEntry[]> } | null {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  return typeof clipboard?.read === 'function' ? clipboard : null
}
