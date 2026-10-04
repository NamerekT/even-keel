import { describe, expect, it } from 'vitest'
import { parseEntry } from '../../src/sessions/entry.js'
import { DEFAULT_STEPS, rulesFor, runsOf, segmentsOf, signatureOf, stepOf, type StepRun } from './step-runs.js'
import type { TranscriptEntry } from './stream.js'

const OUT = 'C:\\Users\\john\\AppData\\Local\\Temp\\claude\\s1\\tasks'

interface CallOptions {
  name?: string
  seconds?: number
  result?: string
  isError?: boolean
  agentId?: string
  cwd?: string
  branch?: string
}

class Transcript {
  private readonly lines: string[] = []
  private n = 0
  private clock = Date.parse('2026-10-03T10:00:00.000Z')
  cwd = 'D:\\Work\\Game'
  branch = 'main'

  wait(seconds: number): this {
    this.clock += seconds * 1000
    return this
  }

  prompt(text: string, agentId?: string): this {
    return this.line({ type: 'user', agentId, message: { role: 'user', content: text } })
  }

  call(id: string, command: string, options: CallOptions = {}): this {
    return this.tool(id, options.name ?? 'Bash', { command }, options)
  }

  tool(id: string, name: string, input: Record<string, unknown>, options: CallOptions = {}): this {
    const place = { cwd: options.cwd ?? this.cwd, gitBranch: options.branch ?? this.branch }
    this.line({
      type: 'assistant',
      agentId: options.agentId,
      ...place,
      message: { id: `m${this.n + 1}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] },
    })
    this.wait(options.seconds ?? 0)
    if (options.result === undefined && options.seconds === undefined) return this
    return this.line({
      type: 'user',
      agentId: options.agentId,
      ...place,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: options.result ?? 'fine', is_error: options.isError === true }],
      },
    })
  }

  background(id: string, task: string, command: string, options: CallOptions = {}): this {
    const result = `Command running in background with ID: ${task}. Output is being written to: ${OUT}\\${task}.output. You will be notified when it completes.`
    return this.call(id, command, { ...options, seconds: options.seconds ?? 1, result })
  }

  notify(id: string, task: string, status: string, summary: string, asText = false): this {
    const prompt = `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>${OUT}\\${task}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`
    if (asText) return this.line({ type: 'user', message: { role: 'user', content: prompt } })
    return this.line({ type: 'attachment', attachment: { type: 'queued_command', prompt, origin: { kind: 'task-notification' } } })
  }

  entries(): TranscriptEntry[] {
    return this.lines.map((line) => parseEntry(line)!)
  }

  private line(fields: Record<string, unknown>): this {
    this.clock += 1000
    this.lines.push(JSON.stringify({ ...fields, uuid: `u${++this.n}`, sessionId: 's1', timestamp: new Date(this.clock).toISOString() }))
    return this
  }
}

const GAMMA = rulesFor(DEFAULT_STEPS, 'Gamma')
const OWN = rulesFor(DEFAULT_STEPS, 'EvenKeel')

const brief = (runs: StepRun[]) => runs.map((run) => [run.toolUseId, run.step, run.mode, run.endBy, run.outcome, run.seconds, run.polls])

describe('segmentsOf', () => {
  it('splits a command on separators and pipes', () => {
    expect(segmentsOf('cd /d/x && npm run build 2>&1 | tail -5; echo done\nls || true')).toEqual([
      'cd /d/x',
      'npm run build 2>&1',
      'tail -5',
      'echo done',
      'ls',
      'true',
    ])
  })

  it('keeps the PowerShell call operator inside its segment', () => {
    expect(segmentsOf('& C:\\Game\\tools\\unity-check.ps1 -Check Build')).toEqual(['& C:\\Game\\tools\\unity-check.ps1 -Check Build'])
  })
})

describe('stepOf', () => {
  it.each([
    ['& C:\\Game\\tools\\unity-check.ps1 -Check Build', 'unity-check'],
    ['$main="C:\\Game"; $root=$main; & "$main\\tools\\unity-check.ps1" -Check EditMode', 'unity-check'],
    ['pwsh -NoProfile -File tools/unity-check.ps1', 'unity-check'],
    ['& "C:\\Program Files\\Unity\\Editor\\Unity.exe" -batchmode -quit -projectPath .', 'unity-batch'],
    ['Start-Process -FilePath "C:\\Unity\\Unity.exe" -ArgumentList "-batchmode","-logFile",".temp/b.log"', 'unity-batch'],
    ['cd C:/Game && dotnet test Tests/Game.Tests.csproj --filter Smoke', 'dotnet-test'],
    ['npx vitest run tally/src/x.test.ts 2>&1 | tail -20', 'vitest'],
    ['node --env-file=.env node_modules/vitest/vitest.mjs run tally/src/x.test.ts', 'vitest'],
    ['npm test', 'vitest'],
    ['npm run build', 'build'],
    ['npx tsc --noEmit -p tsconfig.json', 'build'],
    ['git -C D:/Work/Game merge --no-edit cbl-7/task', 'git-merge'],
  ])('%s is %s', (command, step) => {
    expect(stepOf(command, GAMMA)).toBe(step)
  })

  it.each([
    'grep -c FAIL .temp/unity-check/*.log',
    'wc -l tools/unity-check.ps1',
    'ssh -o BatchMode=yes server uptime',
    'cat vitest.config.ts',
    'git log --merges -5',
  ])('%s is no step', (command) => {
    expect(stepOf(command, GAMMA)).toBeNull()
  })

  it('takes project rules only for their project', () => {
    expect(stepOf('& tools/unity-check.ps1', OWN)).toBeNull()
  })

  it('prefers a project rule over a common one', () => {
    const rules = rulesFor({ ...DEFAULT_STEPS, projects: { Game: { 'game-build': '^npm\\s+run\\s+build\\b' } } }, 'game')
    expect(stepOf('npm run build', rules)).toBe('game-build')
  })
})

describe('signatureOf', () => {
  it.each([
    ['cd /d/x && git status --short', 'git status'],
    ['$env:X = "1"; & C:\\tools\\deploy.ps1 -Fast', 'deploy.ps1'],
    ['npm run lint -- --fix', 'npm run lint'],
    ['FOO=1 node.exe scripts/seed.js --all', 'node seed.js'],
    ['env -u CLAUDE_CONFIG_DIR node --import tsx tally/src/main.ts', 'node tsx'],
    ['mkdir -p .temp && Set-Location D:/x && python -m pytest -q', 'python pytest'],
    ['cd /d/x && S="C:/a b/sql.mjs" && node "$S" "select 1"', 'node $S'],
  ])('%s is %s', (command, signature) => {
    expect(signatureOf(command)).toBe(signature)
  })
})

describe('runsOf', () => {
  it('times a foreground call from the call to its result', () => {
    const t = new Transcript()
      .call('a', 'npm run build', { seconds: 40 })
      .call('b', 'npx vitest run', { seconds: 12, isError: true, result: 'Exit code 1\n1 failed' })
      .call('c', 'dotnet test', { seconds: 120, isError: true, result: 'Command timed out after 2m 0.0s' })
    expect(brief(runsOf(t.entries(), OWN))).toEqual([
      ['a', 'build', 'foreground', 'result', 'ok', 41, 0],
      ['b', 'vitest', 'foreground', 'result', 'fail', 13, 0],
      ['c', 'dotnet-test', 'foreground', 'result', 'timeout', 121, 0],
    ])
  })

  it('leaves out a foreground call that never got its result', () => {
    const t = new Transcript().call('a', 'npm run build')
    expect(runsOf(t.entries(), OWN)).toEqual([])
  })

  it('ends a background run at its completion notification', () => {
    const t = new Transcript()
      .background('a', 'b1', '& tools/unity-check.ps1 -Check Build')
      .wait(200)
      .notify('a', 'b1', 'completed', 'Background command "Unity check" completed (exit code 0)')
      .background('b', 'b2', '& tools/unity-check.ps1 -Check EditMode')
      .wait(50)
      .notify('b', 'b2', 'failed', 'Background command "Unity check" failed with exit code 1', true)
    expect(brief(runsOf(t.entries(), GAMMA))).toEqual([
      ['a', 'unity-check', 'background', 'notification', 'ok', 203, 0],
      ['b', 'unity-check', 'background', 'notification', 'fail', 53, 0],
    ])
  })

  it('takes a call moved to the background after its timeout as a background run', () => {
    const result = `Command did not complete within its 120s timeout and was moved to the background (ID: b9). Output is being written to: ${OUT}\\b9.output. You will be notified when it completes.`
    const t = new Transcript()
      .call('a', 'dotnet test', { seconds: 120, result })
      .wait(60)
      .notify('a', 'b9', 'completed', 'Background command "dotnet test" completed (exit code 0)')
    expect(brief(runsOf(t.entries(), OWN))).toEqual([['a', 'dotnet-test', 'background', 'notification', 'ok', 182, 0]])
  })

  it('ends a background run without notification at its last poll', () => {
    const t = new Transcript()
      .background('a', 'b1', '& tools/unity-check.ps1')
      .tool('r', 'Read', { file_path: `${OUT}\\b1.output` }, { seconds: 1 })
      .call('s', 'sleep 60', { seconds: 60 })
      .call('p', `tail -5 "${OUT.replaceAll('\\', '/')}/b1.output"`, { seconds: 1 })
      .call('g', 'git status', { seconds: 1 })
    expect(brief(runsOf(t.entries(), GAMMA))).toEqual([
      ['a', 'unity-check', 'background', 'poll', null, 70, 3],
      ['g', null, 'foreground', 'result', 'ok', 2, 0],
    ])
  })

  it('counts polls before the notification but keeps the notification as the end', () => {
    const t = new Transcript()
      .background('a', 'b1', 'npm run build')
      .tool('o', 'TaskOutput', { task_id: 'b1' }, { seconds: 30 })
      .notify('a', 'b1', 'completed', 'Background command "build" completed (exit code 0)')
      .tool('r', 'Read', { file_path: `${OUT}\\b1.output` }, { seconds: 1 })
    const [run] = runsOf(t.entries(), OWN)
    expect([run!.endBy, run!.seconds, run!.polls]).toEqual(['notification', 35, 1])
  })

  it('ends a background run stopped by TaskStop as killed', () => {
    const t = new Transcript().background('a', 'b1', 'npm run build').wait(30).tool('k', 'TaskStop', { task_id: 'b1' }, { seconds: 1 })
    expect(brief(runsOf(t.entries(), OWN))).toEqual([['a', 'build', 'background', 'stop', 'killed', 33, 0]])
  })

  it('ends a run at its monitor notification when a monitor waits for it', () => {
    const t = new Transcript()
      .background('a', 'b1', 'npm run build')
      .tool('m', 'Monitor', { command: `until grep -q done ${OUT}\\b1.output; do sleep 5; done` }, { seconds: 1 })
      .wait(100)
      .notify('m', 'b5', 'completed', 'Monitor finished')
    const [run] = runsOf(t.entries(), OWN)
    expect([run!.endBy, run!.seconds, run!.polls]).toEqual(['poll', 106, 1])
  })

  it('leaves a background run open when nothing tells its end', () => {
    const t = new Transcript().background('a', 'b1', 'npm run build', { seconds: 2 })
    expect(brief(runsOf(t.entries(), OWN))).toEqual([['a', 'build', 'background', 'open', null, 3, 0]])
  })

  it('times a detached process by the polls of its log', () => {
    const t = new Transcript()
      .call('a', 'Start-Process -FilePath C:\\Unity\\Unity.exe -ArgumentList "-batchmode","-logFile",".temp/build.log"', {
        name: 'PowerShell',
        seconds: 1,
      })
      .call('s', 'Start-Sleep -Seconds 90', { name: 'PowerShell', seconds: 90 })
      .call('p', 'Get-Content .temp\\build.log -Tail 5', { name: 'PowerShell', seconds: 1 })
    expect(brief(runsOf(t.entries(), GAMMA))).toEqual([['a', 'unity-batch', 'detached', 'poll', null, 97, 2]])
  })

  it('takes Start-Process with -Wait as a foreground run', () => {
    const t = new Transcript().call('a', 'Start-Process C:\\Unity\\Unity.exe -ArgumentList "-batchmode" -Wait', {
      name: 'PowerShell',
      seconds: 30,
    })
    expect(brief(runsOf(t.entries(), GAMMA))).toEqual([['a', 'unity-batch', 'foreground', 'result', 'ok', 31, 0]])
  })

  it('closes the polls of a run at the next prompt of the user', () => {
    const t = new Transcript()
      .background('a', 'b1', 'npm run build')
      .prompt('what now?')
      .call('s', 'sleep 30', { seconds: 30 })
    expect(brief(runsOf(t.entries(), OWN))).toEqual([
      ['a', 'build', 'background', 'open', null, 2, 0],
      ['s', null, 'foreground', 'result', 'ok', 31, 0],
    ])
  })

  it('closes the polls of a run at the next run of the same step', () => {
    const t = new Transcript()
      .background('a', 'b1', 'npm run build')
      .background('b', 'b2', 'npm run build')
      .call('s', 'sleep 30', { seconds: 30 })
    const runs = runsOf(t.entries(), OWN)
    expect(runs.map((run) => [run.toolUseId, run.polls])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })

  it('keeps the streams of subagents apart', () => {
    const t = new Transcript()
      .background('a', 'b1', 'npm run build', { agentId: 'x1' })
      .call('s', 'sleep 30', { seconds: 30 })
    const runs = runsOf(t.entries(), OWN)
    expect(runs.map((run) => [run.toolUseId, run.agentId, run.polls])).toEqual([
      ['a', 'x1', 0],
      ['s', null, 0],
    ])
  })

  it('marks interrupted calls as killed', () => {
    const t = new Transcript().call('a', 'npm run build', { seconds: 5, isError: true, result: '[Request interrupted by user for tool use]' })
    expect(runsOf(t.entries(), OWN)[0]!.outcome).toBe('killed')
  })

  it('places a run in its worktree and branch', () => {
    const t = new Transcript().call('a', 'npm run build', { seconds: 1, cwd: 'D:\\Work\\Game\\.claude\\worktrees\\cbl-7\\tools', branch: 'cbl-7/task' })
    t.call('b', 'npm run build', { seconds: 1, cwd: 'D:\\Work\\Game\\src' })
    expect(runsOf(t.entries(), OWN).map((run) => run.place)).toEqual(['d:/work/game/.claude/worktrees/cbl-7|cbl-7/task', 'd:/work/game/src|main'])
  })

  it('keeps the start of a long command and its signature', () => {
    const t = new Transcript().call('a', `git status ${'x'.repeat(400)}`, { seconds: 1 })
    const [run] = runsOf(t.entries(), OWN)
    expect([run!.command.length, run!.signature]).toEqual([300, 'git status'])
  })
})
