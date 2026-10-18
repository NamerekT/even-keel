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
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `paste-${stamp}.${EXTENSIONS[type] ?? type}`
}
