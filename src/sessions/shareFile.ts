import { isInside, pathsOf } from '../paths.js'
import type { Share } from './share.js'

const WORKTREE = /^(.*)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/
const TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

/** The main checkout of a task worktree or a slot (`<repo>/.claude/worktrees/<name>`), from any folder inside it; else the folder. */
export function checkoutOf(folder: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = pathsOf(platform).resolve(folder)
  return WORKTREE.exec(resolved)?.[1] ?? resolved
}

/**
 * File `index` of a share with its type, the path resolved against the call's folder; only one inside that folder or
 * its main checkout: the page reaches no other file of the machine, whatever the transcript names.
 */
export function sharedFile(share: Share, index: number, platform: NodeJS.Platform = process.platform): { path: string; type: string } | undefined {
  const named = share.files[index]
  if (named === undefined || share.folder === '') return undefined
  const paths = pathsOf(platform)
  const path = paths.resolve(share.folder, named)
  if (!isInside(path, share.folder, platform) && !isInside(path, checkoutOf(share.folder, platform), platform)) return undefined
  return { path, type: TYPES[paths.extname(path).toLowerCase()] ?? 'application/octet-stream' }
}
