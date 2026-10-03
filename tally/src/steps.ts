import { readHulyCredentials } from '../../src/huly/credentials.js'
import { askModel, costRows, excerptOf, llmSettings, parseVerdict, PROMPT_VERSION, promptOf } from './classify.js'
import type { ClassifySettings } from './config.js'
import type { TallyDb } from './db.js'
import { fetchTasks, reportTimes } from './huly.js'
import { findSigns, signKey, spansOf, type SignRules } from './signs.js'
import { turnsKey, turnsOf } from './turns.js'

const TASK_MAX_AGE_MINUTES = 60
const REPORT_IDLE_MINUTES = 60
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

export async function refreshTurns(db: TallyDb): Promise<number> {
  let sessions = 0
  for (const state of await db.turnStates()) {
    const launched = state.launchReason != null
    const key = turnsKey(launched)
    if (state.key === key && state.signedAt === state.lastAt) continue
    await db.writeTurns(state.sessionId, state.lastAt, key, turnsOf(await db.sessionEntries(state.sessionId), launched))
    sessions++
  }
  return sessions
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

export async function reportTaskTimes(db: TallyDb, since: string | null, log: Log): Promise<number> {
  const credentials = readHulyCredentials(process.env)
  if (since === null || credentials === undefined) return 0
  const pending = await db.pendingReports(since, REPORT_IDLE_MINUTES)
  if (pending.length === 0) return 0
  try {
    const reported = await reportTimes(credentials, pending, HULY_TIMEOUT_MS)
    await db.markReported(reported)
    return reported.size
  } catch (error) {
    log(`tally: Huly time reports not written: ${(error as Error).message}`)
    return 0
  }
}

export async function classifySpans(db: TallyDb, settings: ClassifySettings, log: Log): Promise<number> {
  if (settings.perRun === 0) return 0
  const pending = await db.pendingSpans(settings)
  if (pending.length === 0) return 0
  const llm = llmSettings(process.env)
  if (llm === undefined) {
    log('tally: set TALLY_LLM_URL and TALLY_LLM_KEY in .env, classifier skipped')
    return 0
  }
  let classified = 0
  for (const span of pending) {
    const excerpt = excerptOf(await db.sessionEntries(span.sessionId), span)
    let answer
    try {
      answer = await askModel(llm, promptOf(span.task, span.signs, excerpt))
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
      costRows(answer.sessionId || span.id, answer.usage, 'litellm', new Date().toISOString()),
    )
    classified++
  }
  return classified
}
