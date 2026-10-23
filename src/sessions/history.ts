import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRecord } from '../state.js'
import { blocksOf, imagesOf, parseEntry, type TranscriptImage } from './entry.js'
import { TranscriptFold, type Feed, type TranscriptSummary } from './transcript.js'

const SESSION_ID = /^[0-9a-f][0-9a-f-]{7,63}$/i
/** Any agent's session id: Codex's are UUIDs as Claude's, OpenCode's `ses_<base62>`; anything else is refused. */
const ANY_SESSION_ID = /^[\w-]{1,128}$/
const HISTORY_FEED = 5_000

export async function readSessionRecord(projectsDir: string, sessionId: string): Promise<SessionRecord | undefined> {
  const summary = await foldTranscript(projectsDir, sessionId, new TranscriptFold(HISTORY_FEED))
  if (summary === undefined) return undefined
  return {
    sessionId,
    startedAt: summary.firstActivityAt,
    lastActivityAt: summary.lastActivityAt,
    contextTokens: summary.contextTokens,
    contextWindow: summary.contextWindow,
    tokens: summary.tokens,
    stage: summary.stage,
    feed: summary.feed,
    workdir: summary.workdir,
    branch: summary.gitBranch,
    apiError: summary.apiError?.text ?? null,
    account: null,
  }
}

/** Every prompt, text and tool call of the session, uncut, from line `after` on: lines are only ever appended. */
export async function readTranscript(projectsDir: string, sessionId: string, after = 0): Promise<Feed | undefined> {
  const summary = await foldTranscript(projectsDir, sessionId, new TranscriptFold(Infinity, true))
  return summary === undefined ? undefined : { lines: summary.feed.slice(after), turn: summary.turn }
}

/** The path of the session's transcript; `undefined` — the folder has none. */
export async function transcriptFile(projectsDir: string, sessionId: string): Promise<string | undefined> {
  if (!isClaudeId(sessionId)) return undefined
  for (const dir of await readdir(projectsDir).catch(() => [])) {
    const file = join(projectsDir, dir, `${sessionId}.jsonl`)
    if (await stat(file).then((info) => info.isFile(), () => false)) return file
  }
  return undefined
}

/** Picture `index` of the result of call `tool`, as the transcript holds it; `undefined` — there is no such picture. */
export async function readTranscriptImage(projectsDir: string, sessionId: string, tool: string, index: number): Promise<TranscriptImage | undefined> {
  const text = await readSessionFile(projectsDir, sessionId)
  if (text === undefined) return undefined
  const mark = `"tool_use_id":${JSON.stringify(tool)}`
  for (const line of text.split('\n')) {
    if (!line.includes(mark)) continue
    const result = blocksOf(parseEntry(line)?.message?.content).find((block) => block.type === 'tool_result' && block.tool_use_id === tool)
    if (result !== undefined) return imagesOf(result.content)[index]
  }
  return undefined
}

async function foldTranscript(projectsDir: string, sessionId: string, fold: TranscriptFold): Promise<TranscriptSummary | undefined> {
  const text = await readSessionFile(projectsDir, sessionId)
  if (text === undefined) return undefined
  for (const line of text.split('\n')) fold.push(line)
  return fold.summary()
}

async function readSessionFile(projectsDir: string, sessionId: string): Promise<string | undefined> {
  return isClaudeId(sessionId) ? findTranscript(projectsDir, `${sessionId}.jsonl`) : undefined
}

/** Whether the id can be a Claude session's; another agent's id is `false`, so the service asks the next account folder. */
function isClaudeId(sessionId: string): boolean {
  if (!ANY_SESSION_ID.test(sessionId)) throw new Error(`sessions: ${sessionId} is not a session id`)
  return SESSION_ID.test(sessionId)
}

async function findTranscript(projectsDir: string, name: string): Promise<string | undefined> {
  for (const dir of await readdir(projectsDir).catch(() => [])) {
    try {
      return await readFile(join(projectsDir, dir, name), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    }
  }
  return undefined
}
