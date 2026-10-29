import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { TranscriptTail } from '../src/sessions/tail.js'
import { projectDirName } from '../src/sessions/paths.js'
import { RolloutTail } from '../src/codex/tail.js'
import { CopilotTail } from '../src/copilot/tail.js'
import { OpenCodeTail } from '../src/opencode/tail.js'
import { databaseFile } from '../src/opencode/home.js'
import { captureSnapshot } from './cli-sample-capture.js'
import { anonymizeSample, loadSamples, saveSample } from './cli-samples.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const samples = loadSamples(join(import.meta.dirname, '../test/fixtures/cli'))
for (const sample of samples) it(`${sample.provider}: captures both phases through the real tail and saves a replayable sample`, async () => {
  const temp = join(import.meta.dirname, '../.temp')
  mkdirSync(temp, { recursive: true })
  const dir = mkdtempSync(join(temp, 'cli-capture-'))
  dirs.push(dir)
  const sessionId = '00000000-0000-4000-8000-000000000001'
  const entry = { sessionId, cwd: dir, kind: 'test', startedAt: 0 }
  const home = { dir, agent: sample.provider, key: 'example', global: false }
  const snapshots = []
  for (const snapshot of sample.snapshots) {
    let tail
    if ('jsonl' in snapshot.raw) {
      const file = sample.provider === 'claude' ? join(dir, 'projects', projectDirName(dir), `${sessionId}.jsonl`) :
        sample.provider === 'codex' ? join(dir, 'sessions/2026/01/01', `rollout-2026-01-01-${sessionId}.jsonl`) : join(dir, 'session-state', sessionId, 'events.jsonl')
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, snapshot.raw.jsonl)
      tail = sample.provider === 'claude' ? new TranscriptTail(join(dir, 'projects'), entry) :
        sample.provider === 'codex' ? new RolloutTail(dir, entry) : new CopilotTail(dir, entry, async () => undefined)
    } else {
      mkdirSync(dirname(databaseFile(dir)), { recursive: true })
      const db = new DatabaseSync(databaseFile(dir))
      try {
        db.exec(`drop table if exists session; drop table if exists message; drop table if exists part;
          create table session (id text, time_updated integer);
          create table message (id text, session_id text, time_created integer, time_updated integer, data text);
          create table part (id text, message_id text, session_id text, time_created integer, time_updated integer, data text);`)
        db.prepare('insert into session values (?, 1)').run(sessionId)
        for (const row of snapshot.raw.messages) db.prepare('insert into message values (?, ?, ?, 1, ?)').run(row.id, sessionId, row.at, row.data)
        for (const row of snapshot.raw.parts) db.prepare('insert into part values (?, ?, ?, ?, 1, ?)').run(row.id, row.message, sessionId, row.at, row.data)
      } finally { db.close() }
      tail = new OpenCodeTail(dir, entry, async () => [])
    }
    const captured = await captureSnapshot(home, sessionId, tail, snapshot.phase)
    expect(captured.expected).toEqual(snapshot.expected)
    snapshots.push(captured)
  }
  expect(saveSample(join(dir, 'saved'), anonymizeSample({ ...sample, snapshots }))).toContain(sample.version)
})
