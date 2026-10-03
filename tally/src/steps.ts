import { join } from 'node:path'
import type { AccountHomes } from '../../src/account/homes.js'
import { loadLedger } from '../../src/account/ledger.js'
import { readHulyCredentials } from '../../src/huly/credentials.js'
import { resolveClaudeBinary } from '../../src/sessions/claude.js'
import { askClaude, costRows, excerptOf, parseVerdict, PROMPT_VERSION, promptOf } from './classify.js'
import type { ClassifySettings } from './config.js'
import type { TallyDb } from './db.js'
import { fetchTasks } from './huly.js'
import { findSigns, signKey, spansOf, type SignRules } from './signs.js'

const TASK_MAX_AGE_MINUTES = 60
const HULY_TIMEOUT_MS = 30_000

type Log = (message: string) => void

export async function refreshSigns(db: TallyDb, rules: SignRules): Promise<{ sessions: number; spans: number }> {
  let sessions = 0
  let spans = 0
  for (const state of await db.signStates()) {
    const key = signKey(rules, state.launchReason)
    if (state.key === key && state.signedAt === state.lastAt) continue
    const signs = findSigns(await db.sessionEntries(state.sessionId), rules, state.launchReason)
    const found = spansOf(state.sessionId, signs)
    await db.writeSigns(state.sessionId, state.lastAt, key, signs, found)
    sessions++
    spans += found.length
  }
  return { sessions, spans }
}

export async function refreshTasks(db: TallyDb, log: Log): Promise<number> {
  const credentials = readHulyCredentials(process.env)
  if (credentials === undefined) return 0
  const asked = await db.staleTasks(TASK_MAX_AGE_MINUTES)
  if (asked.length === 0) return 0
  try {
    const records = await fetchTasks(credentials, asked, HULY_TIMEOUT_MS)
    await db.writeTasks(asked, records)
    return records.length
  } catch (error) {
    log(`tally: Huly tasks not fetched: ${(error as Error).message}`)
    return 0
  }
}

export async function classifySpans(db: TallyDb, settings: ClassifySettings, stateDir: string, homes: AccountHomes, log: Log): Promise<number> {
  if (settings.perRun === 0) return 0
  const pending = await db.pendingSpans(settings)
  if (pending.length === 0) return 0
  const active = loadLedger(join(stateDir, 'account.json')).active
  const home = homes.find(active)
  if (home === undefined) {
    log(`tally: Baton's active account ${active} has no folder, classifier skipped`)
    return 0
  }
  const binary = resolveClaudeBinary(process.env)
  const env = homes.envOf(home)
  let classified = 0
  for (const span of pending) {
    const excerpt = excerptOf(await db.sessionEntries(span.sessionId), span)
    let answer
    try {
      answer = await askClaude(binary, env, promptOf(span.task, span.signs, excerpt))
    } catch (error) {
      log(`tally: classifier stopped for this run: ${(error as Error).message}`)
      break
    }
    let verdict
    try {
      verdict = parseVerdict(answer.result)
    } catch (error) {
      log(`tally: span ${span.id}: ${(error as Error).message}`)
      verdict = { reason: 'other', note: `Ответ классификатора не разобран: ${answer.result.slice(0, 300)}` }
    }
    const model = answer.usage.map((item) => item.model).join(', ') || null
    await db.writeReason(
      span,
      { ...verdict, promptVersion: PROMPT_VERSION, model, classifierSession: answer.sessionId || null },
      costRows(answer.sessionId || span.id, answer.usage, home.key, new Date().toISOString()),
    )
    classified++
  }
  return classified
}
