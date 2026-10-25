import type { FeedLine } from './transcript.js'

const NOTE = /(^|\/)\.temp\/handoff\.md$/
const WRITES = new Set(['Write', 'Edit', 'MultiEdit'])
const SHELLS = new Set(['Shell', 'Bash'])
const NEAR_END = 3

const isNote = (path: string) => NOTE.test(path.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'))

/** Literal write targets only: quoted content mentioning the note and reads of it must not hold a turn. */
function shellWritesNote(command: string): boolean {
  const tokens = command.match(/"(?:[^"`]|`.)*"|'(?:[^']|'')*'|>>?|[\n();|,]|[^\s"'();|,>]+/g) ?? []
  return tokens.some((token, i) => {
    if (/^>>?$/.test(token)) return isNote(tokens[i + 1] ?? '')
    if (/::(?:WriteAllText|WriteAllLines|AppendAllText)$/i.test(token) && tokens[i + 1] === '(') return isNote(tokens[i + 2] ?? '')
    if (!/^(?:Set-Content|Add-Content|Out-File)$/i.test(token)) return false
    if (i > 0 && ![';', '|', '\n', '(', '&', '&&'].includes(tokens[i - 1]!)) return false
    const next = tokens[i + 1] ?? ''
    return isNote(/^-(?:LiteralPath|Path|FilePath)$/i.test(next) ? tokens[i + 2] ?? '' : next)
  })
}

/**
 * The turn wrote `.temp/handoff.md` among its last few tool calls: with no `CHECKPOINT` line after it, the checkpoint
 * plugin's Stop hook sends the session back to add it. `feed` is a whole transcript's.
 */
export function noteAtEnd(feed: readonly FeedLine[]): boolean {
  const start = feed.findLastIndex((line) => line.kind === 'prompt' || line.kind === 'answer')
  const tools = feed.slice(start + 1).filter((line) => line.kind === 'tool')
  return tools.slice(-NEAR_END).some((line) =>
    WRITES.has(line.name ?? '') ? isNote(line.subject ?? '') : SHELLS.has(line.name ?? '') && shellWritesNote(line.detail ?? ''),
  )
}
