import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_MS = 500

/**
 * A program for the sign-in's `BROWSER` (BTN-1292): `claude auth login` opens its own link, the one whose
 * `redirect_uri` is its listener on `localhost`, with that program; this one opens nothing and appends the link to a
 * file next to it, for the sign-in dialog to offer as "On this computer". The CLI runs it without a shell; a `.cmd`
 * takes `%1`, quotes and all, since `%~1` lets the link's `&` cut it.
 */
export interface LoginBrowser {
  /** The path for `BROWSER`. */
  readonly program: string
  /** Every link handed over so far. */
  links(): Promise<string[]>
  /** Calls `onLink` once for each new link until the returned stop. */
  watch(onLink: (link: string) => void, intervalMs?: number): () => void
  remove(): void
}

export function openLoginBrowser(platform: NodeJS.Platform = process.platform): LoginBrowser {
  const dir = mkdtempSync(join(tmpdir(), 'even-keel-browser-'))
  const file = join(dir, 'links.txt')
  const windows = platform === 'win32'
  const program = join(dir, windows ? 'open.cmd' : 'open.sh')
  // The redirection goes first, so a link ending in a digit is not read as a handle number.
  const script = windows ? `@>>"${file}" echo %1\r\n` : `#!/bin/sh\nprintf '%s\\n' "$1" >> '${file.replaceAll("'", `'\\''`)}'\n`
  writeFileSync(program, script, { mode: 0o755 })
  const links = async () => linksOf(await readFile(file, 'utf8').catch(() => ''))
  return {
    program,
    links,
    watch(onLink, intervalMs = POLL_MS) {
      const seen = new Set<string>()
      let reading = false
      const timer = setInterval(() => {
        if (reading) return
        reading = true
        void links().then((all) => {
          for (const link of all) {
            if (seen.has(link)) continue
            seen.add(link)
            onLink(link)
          }
        }).finally(() => { reading = false })
      }, intervalMs)
      return () => clearInterval(timer)
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** The links of the file: a line each, without the quotes `%1` keeps; `echo` of no argument and the like are dropped. */
export function linksOf(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim().replace(/^"(.*)"$/, '$1')).filter((line) => /^https?:\/\//.test(line))
}
