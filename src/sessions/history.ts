import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRecord } from '../state.js'
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

async function foldTranscript(projectsDir: string, sessionId: string, fold: TranscriptFold): Promise<TranscriptSummary | undefined> {
  if (!SESSION_ID.test(sessionId)) throw new Error(`sessions: ${sessionId} is not a session id`)
  const text = await findTranscript(projectsDir, `${sessionId}.jsonl`)
  if (text === undefined) return undefined
  for (const line of text.split('\n')) fold.push(line)
  return fold.summary()
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
