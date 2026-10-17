import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRecord } from '../state.js'
import { blocksOf, imagesOf, parseEntry, type TranscriptImage } from './entry.js'
import { TranscriptFold, type FeedLine, type TranscriptSummary } from './transcript.js'

const SESSION_ID = /^[0-9a-f][0-9a-f-]{7,63}$/i
const HISTORY_FEED = 5_000

export async function readSessionRecord(projectsDir: string, sessionId: string): Promise<SessionRecord | undefined> {
  const summary = await foldTranscript(projectsDir, sessionId, new TranscriptFold(HISTORY_FEED))
  if (summary === undefined) return undefined
  return {
    sessionId,
    startedAt: summary.firstActivityAt,
    lastActivityAt: summary.lastActivityAt,
    contextTokens: summary.contextTokens,
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
export async function readTranscript(projectsDir: string, sessionId: string, after = 0): Promise<FeedLine[] | undefined> {
  return (await foldTranscript(projectsDir, sessionId, new TranscriptFold(Infinity, true)))?.feed.slice(after)
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
  if (!SESSION_ID.test(sessionId)) throw new Error(`sessions: ${sessionId} is not a session id`)
  return findTranscript(projectsDir, `${sessionId}.jsonl`)
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
