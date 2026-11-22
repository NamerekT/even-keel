/** The extensions of a media type, the usual one first. */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'image/bmp': ['bmp'],
  'image/svg+xml': ['svg'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/ogg': ['ogg'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
  'application/json': ['json'],
  'text/plain': ['txt', 'log'],
  'text/csv': ['csv'],
  'text/markdown': ['md'],
}

/**
 * A file's name with the extension of the type it is served with, for a tracker that names an upload by an id alone
 * (GitHub's `user-attachments/assets/<uuid>`): a name already ending with one of the type's extensions stays, and so
 * does any name of a type with none known.
 */
export function withExtension(name: string, type: string): string {
  const known = EXTENSIONS[type.split(';')[0]!.trim().toLowerCase()]
  if (known === undefined) return name
  const lower = name.toLowerCase()
  return known.some((extension) => lower.endsWith(`.${extension}`)) ? name : `${name}.${known[0]}`
}
