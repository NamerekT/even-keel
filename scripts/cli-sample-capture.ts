import { readFileSync } from 'node:fs'
import type { AccountHome } from '../src/account/homes.js'
import type { SessionTail } from '../src/agent/contract.js'
import { sessionRows } from '../src/opencode/db.js'
import { sampleSummary, type CliSnapshot, type SampleRaw } from './cli-samples.js'

export async function captureSnapshot(home: AccountHome, sessionId: string, tail: SessionTail, phase: CliSnapshot['phase']): Promise<CliSnapshot> {
  await tail.read()
  let raw: SampleRaw
  if (home.agent === 'opencode') {
    const rows = await sessionRows(home.dir, sessionId)
    if (rows === undefined) throw new Error('no OpenCode rows for the sample')
    raw = { messages: rows.messages, parts: rows.parts }
  } else {
    if (tail.path === undefined) throw new Error('no transcript file for the sample')
    raw = { jsonl: readFileSync(tail.path, 'utf8') }
  }
  return { phase, raw, expected: sampleSummary(tail.summary()) }
}
