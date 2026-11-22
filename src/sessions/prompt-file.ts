import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where a prompt too long for the command line goes, in the session's own folder: git ignores `.temp/` (`ensureIgnored`). */
export const PROMPT_DIR = '.temp/even-keel-prompts'

/** `CreateProcess` takes at most 32,767 characters of command line. */
const WINDOWS_LINE = 32_767

/**
 * What the `--bg` daemon adds to the line it spawns the session with: `<binary> --bg-pty-host <pipe> <cols> <rows> --`
 * before the CLI's own line, `--session-id <id>` in it (CLI 2.1.330). The binary is counted again on top.
 */
const DAEMON_WRAP = 512

/** Linux's `MAX_ARG_STRLEN`, one argument; the whole of argv and the environment is kept well under macOS' 1 MiB. */
const ARG_BYTES = 128 * 1024
const ARGV_BYTES = 512 * 1024

const POINTER =
  /^Your message did not fit the command line, so Even Keel put it whole in the file (\.temp\/even-keel-prompts\/prompt-[0-9a-f-]+\.md)\. Read all of that file now, in parts if it is long, and act on it as this message\.$/

/**
 * Whether the line a session is spawned with fits the system's limit. On Windows it is counted as libuv quotes it
 * (`quote_cmd_arg`), at most: an argument with a space, a tab or a quote is quoted, each quote and backslash in it
 * may take a backslash more.
 */
export function commandLineFits(binary: string, args: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    const line = [binary, ...args].reduce((sum, arg) => sum + quotedLength(arg) + 1, 0)
    return line + binary.length + DAEMON_WRAP <= WINDOWS_LINE
  }
  const sizes = args.map((arg) => Buffer.byteLength(arg) + 1)
  return sizes.every((size) => size <= ARG_BYTES) && sizes.reduce((sum, size) => sum + size, 0) <= ARGV_BYTES
}

function quotedLength(arg: string): number {
  if (arg === '') return 2
  if (!/[ \t"]/.test(arg)) return arg.length
  const escapes = arg.match(/["\\]/g)?.length ?? 0
  return arg.length + 2 + escapes
}

/** Writes the prompt into a file of its own under `PROMPT_DIR` and gives its path from the folder, with forward slashes. */
export async function writePromptFile(cwd: string, prompt: string, now = Date.now()): Promise<string> {
  const name = `prompt-${now}-${randomBytes(4).toString('hex')}.md`
  await mkdir(join(cwd, PROMPT_DIR), { recursive: true })
  await writeFile(join(cwd, PROMPT_DIR, name), prompt, 'utf8')
  return `${PROMPT_DIR}/${name}`
}

/** The short prompt that stands for one in a file of `writePromptFile`. */
export function promptPointer(path: string): string {
  return `Your message did not fit the command line, so Even Keel put it whole in the file ${path}. Read all of that file now, in parts if it is long, and act on it as this message.`
}

/**
 * The prompt a `promptPointer` stands for, read from the session's folder; any other text, or a file gone with its
 * worktree, as it is. Only a file of `PROMPT_DIR` is read: the pattern takes no other path.
 */
export function expandPromptFile(text: string, cwd: string | undefined): string {
  const path = POINTER.exec(text.trim())?.[1]
  if (path === undefined || cwd === undefined) return text
  try {
    return readFileSync(join(cwd, path), 'utf8')
  } catch {
    return text
  }
}
