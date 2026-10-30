import { askModel, costRows, excerptOf, llmSettings, parseVerdict, PROMPT_VERSION, promptOf } from './classify.js'
import type { ClassifySettings } from './config.js'
import type { TallyDb } from './db.js'
import { fetchTasks, reportTimes } from './huly.js'
import { byCredentials, type HulyOf } from './huly-profiles.js'
import { findSigns, signKey, spansOf, type SignRules } from './signs.js'
import { rulesFor, runsOf, stepsKey, type StepSettings } from './step-runs.js'
import { turnsKey, turnsOf, type TurnSource } from './turns.js'

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

/**
 * A session of `sources` (Codex, OpenCode, Copilot) is split from its own transcript, any other from Claude's lines.
 * Turns whose source is gone are kept: their key is `<agent>:…`, never the bare hash of Claude's turns.
 */
export async function refreshTurns(
  db: Pick<TallyDb, 'turnStates' | 'writeTurns' | 'sessionEntries'>,
  sources: TurnSource[] = [],
  onReadError?: (path: string, error: unknown) => void,
): Promise<number> {
  let sessions = 0
  const bySession = new Map(sources.map((source) => [source.session, source]))
  for (const state of await db.turnStates()) {
    const source = bySession.get(state.sessionId)
    if (source === undefined && state.key?.includes(':')) continue
    const launched = state.launchReason != null
    const key = source === undefined ? turnsKey(launched) : source.key(launched)
    if (state.key === key && state.signedAt === state.lastAt) continue
    let turns
    if (source === undefined) turns = turnsOf(await db.sessionEntries(state.sessionId), launched)
    else {
      try {
        turns = await source.read(launched)
      } catch (error) {
        if (onReadError === undefined) throw error
        onReadError(source.path, error)
        continue
      }
    }
    await db.writeTurns(state.sessionId, state.lastAt, key, turns)
    sessions++
  }
  return sessions
}

export async function refreshSteps(db: TallyDb, settings: StepSettings): Promise<number> {
  await db.setMeta('steps', JSON.stringify({ slowSeconds: settings.slowSeconds, growth: settings.growth }))
  let sessions = 0
  for (const state of await db.stepStates()) {
    const rules = rulesFor(settings, state.project)
    const key = stepsKey(rules)
    if (state.key === key && state.signedAt === state.lastAt) continue
    await db.writeSteps(state.sessionId, state.lastAt, key, runsOf(await db.sessionEntries(state.sessionId), rules))
    sessions++
  }
  return sessions
}

/** Each set of credentials asks for the tasks of its projects; a task no profile reaches stays unasked. */
export async function refreshTasks(db: TallyDb, hulyOf: HulyOf, log: Log): Promise<number> {
  const asked = await db.staleTasks(TASK_MAX_AGE_MINUTES)
  let fetched = 0
  for (const { credentials, items } of byCredentials(asked, (task) => task, hulyOf)) {
    try {
      const records = await fetchTasks(credentials, items, HULY_TIMEOUT_MS)
      await db.writeTasks(items, records)
      fetched += records.length
    } catch (error) {
      log(`tally: Huly tasks of ${credentials.workspace} not fetched: ${(error as Error).message}`)
    }
  }
  return fetched
}

export async function reportTaskTimes(db: TallyDb, since: string | null, hulyOf: HulyOf, log: Log): Promise<number> {
  if (since === null) return 0
  const pending = await db.pendingReports(since, REPORT_IDLE_MINUTES)
  let written = 0
  for (const { credentials, items } of byCredentials(pending, (report) => report.task, hulyOf)) {
    try {
      const reported = await reportTimes(credentials, items, HULY_TIMEOUT_MS)
      await db.markReported(reported)
      written += reported.size
    } catch (error) {
      log(`tally: Huly time reports of ${credentials.workspace} not written: ${(error as Error).message}`)
    }
  }
  return written
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
