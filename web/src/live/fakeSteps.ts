import type { PeriodQuery, StatsAnswer } from '../../../src/stats/model.js'
import { DEFAULT_STEP_SETTINGS, stepsOf, type StatsSteps, type StatsTaskStep, type StepRunRow } from '../../../src/stats/steps.js'
import { addDays, bucketOf, dayCount } from '../stats/period.js'
import { failure } from './fakeStats.js'

interface FakeStep {
  step: string
  perDay: number
  warm: [number, number]
  cold: [number, number]
  coldShare: number
  failShare: number
  share: number
}

const STEPS: FakeStep[] = [
  { step: 'unity-check', perDay: 6, warm: [20, 60], cold: [120, 420], coldShare: 0.25, failShare: 0.2, share: 0.31 },
  { step: 'unity-batch', perDay: 4, warm: [15, 45], cold: [60, 180], coldShare: 0.3, failShare: 0.05, share: 0.12 },
  { step: 'dotnet-test', perDay: 12, warm: [4, 20], cold: [10, 40], coldShare: 0.1, failShare: 0.04, share: 0.08 },
  { step: 'vitest', perDay: 8, warm: [1.5, 9], cold: [3, 12], coldShare: 0.1, failShare: 0.03, share: 0.02 },
  { step: 'build', perDay: 5, warm: [3, 12], cold: [8, 40], coldShare: 0.2, failShare: 0.05, share: 0.03 },
  { step: 'git-merge', perDay: 2, warm: [1, 4], cold: [1, 6], coldShare: 0.5, failShare: 0.01, share: 0.004 },
]

const UNKNOWN = [
  { signature: 'python <<EOF', n: 412, seconds: 2310, max: 380, command: "python <<'EOF' ⏎ import json ⏎ …" },
  { signature: 'ssh BatchMode=yes', n: 41, seconds: 980, max: 143, command: 'ssh -o BatchMode=yes deploy@example.com "docker compose pull"' },
  { signature: 'dotnet run', n: 37, seconds: 610, max: 99, command: 'dotnet run --project tools/AtlasPacker -- --all' },
  { signature: 'npm run e2e', n: 9, seconds: 420, max: 75, command: 'npm run e2e -- --project=chromium' },
]

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function runsOf(query: PeriodQuery): StepRunRow[] {
  const next = random(dayCount(query) * 71 + (query.projects?.length ?? 9))
  const scale = (query.scope === 'chain' ? 0.7 : 1) * (query.projects === null ? 1 : Math.min(1, query.projects.length / 3))
  const first = addDays(query.from, -7)
  const runs: StepRunRow[] = []
  for (let day = first; day <= query.to; day = addDays(day, 1)) {
    const late = dayCount({ from: day, to: query.to }) <= 7
    for (const fake of STEPS) {
      const count = Math.round(fake.perDay * scale * (0.4 + next() * 1.2))
      for (let index = 0; index < count; index++) {
        const cold = next() < fake.coldShare
        const [low, high] = cold ? fake.cold : fake.warm
        const slower = late && fake.step === 'unity-check' ? 2.4 : 1
        const seconds = (low + (high - low) * next() ** 2) * slower
        const startedAt = Date.parse(`${day}T09:00:00Z`) + next() * 10 * 3_600_000
        const roll = next()
        runs.push({
          step: fake.step,
          task: null,
          week: bucketOf(day, 'week'),
          startedAt,
          endedAt: startedAt + seconds * 1000,
          seconds,
          cold,
          outcome: roll < fake.failShare ? 'fail' : roll < fake.failShare * 1.1 ? 'timeout' : 'ok',
          current: day >= query.from,
        })
      }
    }
  }
  return runs
}

export function fakeSteps(mode: string | null, query: PeriodQuery): StatsAnswer<StatsSteps> {
  const failed = failure<StatsSteps>(mode)
  if (failed !== null) return failed
  const empty = mode === 'empty' || (query.projects !== null && query.projects.length === 0)
  const runs = empty ? [] : runsOf(query)
  const shares = new Map(STEPS.map((fake) => [fake.step, fake.share]))
  return {
    state: 'ok',
    data: {
      query,
      at: new Date().toISOString(),
      settings: DEFAULT_STEP_SETTINGS,
      tasks: empty ? 0 : Math.max(1, Math.round(dayCount(query) * 1.3)),
      steps: stepsOf(runs, DEFAULT_STEP_SETTINGS, shares),
      unknown: empty ? [] : UNKNOWN,
    },
  }
}

export function fakeTaskSteps(task: string): StatsTaskStep[] {
  const next = random(task.length * 313 + Number(task.split('-')[1] ?? 0))
  const base = 1200 * (1 + next() * 2)
  return STEPS.filter(() => next() > 0.35)
    .map((fake) => {
      const runs = 1 + Math.floor(next() * 12)
      const seconds = runs * (fake.warm[0] + (fake.warm[1] - fake.warm[0]) * next())
      return { step: fake.step, runs, seconds, share: Math.min(1, seconds / base) }
    })
    .sort((a, b) => b.seconds - a.seconds)
}
