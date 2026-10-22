/** The tool by which a session sends the user files (BTN-305). */
export const SHARE_TOOL = 'SendUserFile'

/** The files a `SendUserFile` call sent, as the call names them, and the folder the call was made in. */
export interface Share {
  caption: string
  files: string[]
  /** The session's folder at the call; `''` — the transcript does not say, and the service gives none of the files. */
  folder: string
}

export function shareOf(input: Record<string, unknown>, folder: string): Share {
  const files = (Array.isArray(input.files) ? input.files : []).filter((file): file is string => typeof file === 'string' && file !== '')
  return { caption: typeof input.caption === 'string' ? input.caption.trim() : '', files, folder }
}
