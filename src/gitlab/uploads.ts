import type { TaskAttachment } from '../tracker/card.js'

const LINKS = /https?:\/\/[^\s<>"'()]+|\/[^\s<>"'()]+/g
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf',
}

export function uploadType(file: string, type: string): string {
  return type === '' || type === 'application/octet-stream' ? MEDIA_TYPES[file.split('.').at(-1)!.toLowerCase()] ?? type : type
}

export class GitlabUploads {
  constructor(private readonly web: string, private readonly projectUrl: string, private readonly projectId?: number) {}

  private parse(link: string): TaskAttachment | null {
    let relative = link
    if (/^https?:\/\//.test(link)) {
      if (!link.startsWith(`${this.web}/`)) return null
      relative = link.slice(this.web.length)
    } else {
      const prefix = new URL(this.web).pathname.replace(/\/$/, '')
      if (prefix && relative.startsWith(`${prefix}/`)) relative = relative.slice(prefix.length)
    }
    const projectPath = this.projectUrl.slice(this.web.length)
    if (relative.startsWith(`${projectPath}/uploads/`)) relative = relative.slice(projectPath.length)
    if (this.projectId !== undefined && relative.startsWith(`/-/project/${this.projectId}/uploads/`)) relative = relative.slice(`/-/project/${this.projectId}`.length)
    const match = /^\/uploads\/([a-f\d]{32})\/([^/?#]+)(?:[?#].*)?$/i.exec(relative)
    if (match === null) return null
    let name: string
    try { name = decodeURIComponent(match[2]!) } catch { return null }
    if (name === '.' || name === '..' || /[/\\\x00-\x1f\x7f]/.test(name)) return null
    const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    return { file: `${match[1]}/${encoded}`, name, type: '', size: 0, url: null }
  }

  files(text: string): TaskAttachment[] {
    const files = new Map<string, TaskAttachment>()
    for (const [link] of text.matchAll(LINKS)) {
      const file = this.parse(link)
      if (file !== null) files.set(file.file, file)
    }
    return [...files.values()]
  }

  rewrite(text: string, id: string): string {
    return text.replace(LINKS, (link) => {
      const file = this.parse(link)
      return file === null ? link : `/api/tasks/${encodeURIComponent(id)}/files/${encodeURIComponent(file.file)}`
    })
  }
}
