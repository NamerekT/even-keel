import { createHash } from 'node:crypto'
import { blocksOf } from '../../src/sessions/entry.js'
import { commandOf, streamsOf, type Call, type TranscriptEntry } from './stream.js'

export type StepMode = 'foreground' | 'background' | 'detached'
export type StepEnd = 'result' | 'notification' | 'stop' | 'poll' | 'open'
export type StepOutcome = 'ok' | 'fail' | 'timeout' | 'killed'

export interface StepRun {
  toolUseId: string
  agentId: string | null
  step: string | null
  signature: string
  command: string
  startedAt: string
  endedAt: string
  seconds: number
  mode: StepMode
  endBy: StepEnd
  outcome: StepOutcome | null
  place: string
  polls: number
}

export interface StepGrowth {
  ratio: number
  minRuns: number
  minSeconds: number
}

export interface StepSettings {
  rules: Record<string, string>
  projects: Record<string, Record<string, string>>
  slowSeconds: number
  growth: StepGrowth
}

export interface StepRule {
  name: string
  pattern: RegExp
}

export const DEFAULT_STEPS: StepSettings = {
  rules: {
    vitest: '^(npx|node)\\b.*\\bvitest(\\.mjs)?(\\s|$)|^vitest\\s|^npm\\s+(run\\s+)?test\\b',
    'dotnet-test': '^dotnet\\s+test\\b',
    build: '^npm\\s+run\\s+build\\b|^(npx\\s+)?tsc(\\s|$)|^dotnet\\s+build\\b',
    'git-merge': '^git\\s+(-C\\s+("[^"]*"|\\S+)\\s+)?merge\\b',
  },
  projects: {
    Gamma: {
      'unity-check': '^(&\\s*|(pwsh|powershell)(\\.exe)?\\s+(-\\S+\\s+)*)?["\']?[^\\s"\']*unity-check\\.ps1\\b',
      'unity-batch': 'Unity(\\.exe)?["\']?\\s.*-batchmode',
    },
  },
  slowSeconds: 60,
  growth: { ratio: 1.5, minRuns: 5, minSeconds: 10 },
}

const STEPS_VERSION = 1
const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])
const COMMAND_LIMIT = 300
const BACKGROUND = /in background with ID: ([\w-]+)|moved to the background \(ID: ([\w-]+)\)/
const OUTPUT_FILE = /Output is being written to: (.+?\.output)\b/
const LOG_NAME = /[\w.-]+\.(log|out|output|txt)\b/gi
const SLEEP = /^(sleep\s+\d|Start-Sleep\b|Wait-Process\b|timeout\s+\/t\b)/i
const SKIPPED = /^(cd|Set-Location|pushd|mkdir|New-Item|export)\b|^\$[\w:]+\s*=/i
const ENV_ASSIGN = /^[A-Za-z_]\w*=/
const RUNNERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const TIMEOUT = /timed out|no exit after/i
const INTERRUPTED = /^\[Request interrupted/

export function rulesFor(settings: StepSettings, project: string | null): StepRule[] {
  const own = Object.entries(settings.projects).find(([name]) => project !== null && name.toLowerCase() === project.toLowerCase())
  return [...Object.entries(own?.[1] ?? {}), ...Object.entries(settings.rules)].map(([name, source]) => ({
    name,
    pattern: new RegExp(source, 'i'),
  }))
}

export function stepsKey(rules: StepRule[]): string {
  return createHash('sha1')
    .update(JSON.stringify([STEPS_VERSION, rules.map((rule) => [rule.name, rule.pattern.source])]))
    .digest('hex')
}

export function segmentsOf(command: string): string[] {
  return command
    .split(/\r?\n|;|&&|\|\||\|/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
}

export function stepOf(command: string, rules: StepRule[]): string | null {
  const segments = segmentsOf(command)
  return rules.find((rule) => segments.some((segment) => rule.pattern.test(segment)))?.name ?? null
}

export function signatureOf(command: string): string {
  const segments = segmentsOf(command)
  const segment = segments.find((item) => !SKIPPED.test(item)) ?? segments[0] ?? ''
  const tokens = tokensOf(segment.replace(/^&\s*/, ''))
  while (tokens.length > 0 && ENV_ASSIGN.test(tokens[0]!)) tokens.shift()
  if (tokens[0] === 'env') {
    tokens.shift()
    while (tokens.length > 0 && (tokens[0]!.startsWith('-') || ENV_ASSIGN.test(tokens[0]!))) {
      if (tokens.shift() === '-u') tokens.shift()
    }
  }
  const program = baseName(tokens.shift() ?? '').replace(/\.exe$/i, '')
  const args = tokens.filter((token) => !token.startsWith('-')).map(baseName)
  const words = RUNNERS.has(program) && args[0] === 'run' ? args.slice(0, 2) : args.slice(0, 1)
  return [program, ...words].join(' ').trim()
}

interface Notice {
  at: string
  status: string
  summary: string
}

interface Open {
  run: StepRun
  keys: string[]
  taskId: string | null
  notice: Notice | undefined
  stoppedAt: string | null
  lastPoll: string | null
}

export function runsOf(entries: TranscriptEntry[], rules: StepRule[]): StepRun[] {
  const results = new Map<string, string>()
  const branches = new Map<string, string>()
  const notices = new Map<string, Notice>()
  for (const entry of entries) {
    if (typeof entry.uuid !== 'string' || typeof entry.timestamp !== 'string') continue
    if (typeof entry.gitBranch === 'string') branches.set(entry.uuid, entry.gitBranch)
    for (const block of blocksOf(entry.message?.content)) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && !results.has(block.tool_use_id)) {
        results.set(block.tool_use_id, entry.timestamp)
      }
    }
    const text = noticeText(entry)
    if (text !== null) addNotice(notices, text, entry.timestamp)
  }

  const runs: StepRun[] = []
  for (const stream of streamsOf(entries)) {
    let active: Open[] = []
    const opened: Open[] = []
    for (const event of stream.events) {
      if (event.type === 'prompt') {
        active = []
        continue
      }
      if (event.type !== 'call') continue
      const call = event.call
      const live = active.filter((open) => open.notice === undefined || open.notice.at > call.at)
      const pollAt = notices.get(call.id)?.at ?? results.get(call.id) ?? call.at
      if (call.name === 'TaskStop' || call.name === 'KillShell') {
        const open = byTask(live, idOf(call))
        if (open !== undefined && open.stoppedAt === null) open.stoppedAt = call.at
        continue
      }
      const polled = pollTarget(call, live)
      if (polled !== undefined) {
        polled.run.polls++
        if (polled.lastPoll === null || pollAt > polled.lastPoll) polled.lastPoll = pollAt
        continue
      }
      const command = commandOf(call)
      if (!SHELLS.has(call.name) || command === null) continue
      const resultAt = results.get(call.id)
      if (resultAt === undefined) continue
      const open = launch(call, command, resultAt, rules, branches.get(call.uuid) ?? '', stream.agentId)
      runs.push(open.run)
      if (open.run.mode === 'foreground') continue
      open.notice = notices.get(open.run.toolUseId) ?? (open.taskId !== null ? notices.get(`task:${open.taskId}`) : undefined)
      active = active.filter((other) => sameKind(other.run, open.run) === false)
      active.push(open)
      opened.push(open)
    }
    for (const open of opened) finish(open)
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.toolUseId.localeCompare(b.toolUseId))
}

function launch(call: Call, command: string, resultAt: string, rules: StepRule[], branch: string, agentId: string | null): Open {
  const text = call.result?.text ?? ''
  const background = BACKGROUND.exec(text)
  const taskId = background === null ? null : (background[1] ?? background[2] ?? null)
  const output = OUTPUT_FILE.exec(text)?.[1]
  const mode: StepMode = taskId !== null ? 'background' : isDetached(command) ? 'detached' : 'foreground'
  const keys = [...new Set([...(command.match(LOG_NAME) ?? []), ...(output !== undefined ? [baseName(output)] : [])].map((key) => key.toLowerCase()))]
  if (taskId !== null) keys.push(taskId.toLowerCase())
  const run: StepRun = {
    toolUseId: call.id,
    agentId,
    step: stepOf(command, rules),
    signature: signatureOf(command),
    command: command.slice(0, COMMAND_LIMIT),
    startedAt: call.at,
    endedAt: resultAt,
    seconds: seconds(call.at, resultAt),
    mode,
    endBy: mode === 'foreground' ? 'result' : 'open',
    outcome: mode === 'foreground' ? outcomeOf(call) : null,
    place: placeOf(call.cwd, branch),
    polls: 0,
  }
  return { run, keys, taskId, notice: undefined, stoppedAt: null, lastPoll: null }
}

function finish(open: Open): void {
  const run = open.run
  if (open.notice !== undefined) {
    end(run, open.notice.at, 'notification', noticeOutcome(open.notice))
  } else if (open.stoppedAt !== null) {
    end(run, open.stoppedAt, 'stop', 'killed')
  } else if (open.lastPoll !== null) {
    end(run, open.lastPoll, 'poll', null)
  }
}

function end(run: StepRun, at: string, endBy: StepEnd, outcome: StepOutcome | null): void {
  if (at < run.startedAt) return
  run.endedAt = at
  run.seconds = seconds(run.startedAt, at)
  run.endBy = endBy
  run.outcome = outcome
}

function pollTarget(call: Call, live: Open[]): Open | undefined {
  if (live.length === 0) return undefined
  if (call.name === 'TaskOutput' || call.name === 'BashOutput') return byTask(live, idOf(call))
  const haystack = call.name === 'Read' ? baseName(String(call.input.file_path ?? '')) : SHELLS.has(call.name) || call.name === 'Monitor' ? (commandOf(call) ?? '') : ''
  if (haystack === '') return undefined
  const lower = haystack.toLowerCase()
  const found = live.findLast((open) => open.keys.some((key) => (call.name === 'Read' ? lower === key : lower.includes(key))))
  if (found !== undefined) return found
  if (call.name !== 'Read' && segmentsOf(haystack).every((segment) => SLEEP.test(segment))) return live.at(-1)
  return undefined
}

function byTask(live: Open[], id: string | null): Open | undefined {
  return id === null ? undefined : live.findLast((open) => open.taskId === id)
}

function idOf(call: Call): string | null {
  const id = call.input.task_id ?? call.input.bash_id ?? call.input.shell_id
  return typeof id === 'string' ? id : null
}

function sameKind(a: StepRun, b: StepRun): boolean {
  return a.step !== null ? a.step === b.step : b.step === null && a.signature === b.signature
}

function isDetached(command: string): boolean {
  if (/(^|[^&>|])&\s*$/.test(command.trim())) return true
  return segmentsOf(command).some(
    (segment) => (/^Start-Process\b/i.test(segment) && !/\s-Wait\b/i.test(segment)) || /^(Start-Job|nohup)\b/i.test(segment),
  )
}

function outcomeOf(call: Call): StepOutcome {
  const result = call.result
  if (result === undefined) return 'ok'
  if (INTERRUPTED.test(result.text)) return 'killed'
  if (TIMEOUT.test(result.text)) return 'timeout'
  return result.isError ? 'fail' : 'ok'
}

function noticeOutcome(notice: Notice): StepOutcome | null {
  const status = notice.status.toLowerCase()
  if (TIMEOUT.test(notice.summary)) return 'timeout'
  if (status === 'completed') {
    const code = /exit code (-?\d+)/i.exec(notice.summary)?.[1]
    return code === undefined || code === '0' ? 'ok' : 'fail'
  }
  if (status === 'failed') return 'fail'
  if (/^(killed|stopped|cancell?ed)$/.test(status)) return 'killed'
  return null
}

function noticeText(entry: TranscriptEntry): string | null {
  const attachment = entry.attachment as { prompt?: unknown } | undefined
  const candidates: unknown[] = [attachment?.prompt]
  if (entry.type === 'user') {
    const content = entry.message?.content
    candidates.push(content, ...blocksOf(content).map((block) => (block.type === 'text' ? block.text : undefined)))
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trimStart().startsWith('<task-notification>')) return candidate
  }
  return null
}

function addNotice(notices: Map<string, Notice>, text: string, at: string): void {
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? ''
  const notice: Notice = { at, status: tag('status'), summary: tag('summary') }
  for (const key of [tag('tool-use-id'), tag('task-id') && `task:${tag('task-id')}`]) {
    if (key === '') continue
    const known = notices.get(key)
    if (known === undefined || at < known.at) notices.set(key, notice)
  }
}

function placeOf(cwd: string | undefined, branch: string): string {
  const dir = (cwd ?? '').replaceAll('\\', '/').toLowerCase()
  const worktree = /^(.*?\/\.claude\/worktrees\/[^/]+)/.exec(dir)?.[1]
  return `${worktree ?? dir}|${branch}`
}

function tokensOf(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ''))
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function seconds(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000)
}
