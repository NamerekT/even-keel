import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Reporter, SerializedError, TestModule, TestRunEndReason, Vitest } from 'vitest/node'

/** Where every vitest run of a working folder leaves its report, relative to the folder (each worktree has its own). */
export const LAST_RUN_REPORT = '.temp/vitest-last.json'

const MAX_TAIL_LINES = 20

export interface RunError { name?: string, message: string, stack?: string, diff?: string }
export interface RunTest { name: string, state: 'passed' | 'failed' | 'skipped' | 'pending', errors: RunError[] }
/** A test file: `errors` are its own, outside any test — an import that failed, a hook of a suite. */
export interface RunFile { file: string, errors: RunError[], tests: RunTest[] }
export interface LastRun { reason: TestRunEndReason, files: RunFile[], unhandled: RunError[] }

interface Failure { file: string, test?: string, errors: RunError[] }

function failures(run: LastRun): Failure[] {
  return run.files.flatMap(file => [
    ...(file.errors.length > 0 ? [{ file: file.file, errors: file.errors }] : []),
    ...file.tests.filter(test => test.state === 'failed').map(test => ({ file: file.file, test: test.name, errors: test.errors })),
  ])
}

function totals(run: LastRun) {
  const tests = run.files.flatMap(file => file.tests)
  const count = (state: RunTest['state']) => tests.filter(test => test.state === state).length
  return { files: run.files.length, tests: tests.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), pending: count('pending') }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const firstLine = (text: string) => (text.split('\n')[0] ?? '').slice(0, 160)

function verdict(run: LastRun, report: string): string {
  const head = `vitest: ${run.reason === 'passed' ? 'passed' : run.reason.toUpperCase()} — `
  if (run.files.length === 0) return `${head}no test files ran; report ${report}`
  const sum = totals(run)
  const counts = ([['failed', sum.failed], ['passed', sum.passed], ['skipped', sum.skipped], ['unfinished', sum.pending]] as const)
    .filter(([, n]) => n > 0).map(([word, n]) => `${n} ${word}`)
  const brokenFiles = run.files.filter(file => file.errors.length > 0).length
  const extras = [
    ...(brokenFiles > 0 ? [`${plural(brokenFiles, 'file')} failed outside its tests`] : []),
    ...(run.unhandled.length > 0 ? [plural(run.unhandled.length, 'unhandled error')] : []),
  ]
  const tests = `${counts.length > 0 ? counts.join(', ') : '0'} of ${plural(sum.tests, 'test')} in ${plural(sum.files, 'file')}`
  return `${head}${[tests, ...extras].join(', ')}; report ${report}`
}

/**
 * The last lines of a run: a line for each failed test (`FAIL file > suite > test`), each file broken outside its tests
 * and each unhandled error, then the verdict — at most twenty lines, so `| tail -3` still names what failed.
 */
export function lastRunTail(run: LastRun, report: string): string[] {
  const lines = [
    ...failures(run).map(failure => failure.test === undefined
      ? `FAIL ${failure.file}: ${firstLine(failure.errors[0]?.message ?? '')}`
      : `FAIL ${failure.file} > ${failure.test}`),
    ...run.unhandled.map(error => `ERROR unhandled ${error.name === undefined ? '' : `${error.name}: `}${firstLine(error.message)}`),
  ]
  const room = MAX_TAIL_LINES - 1
  const shown = lines.length <= room ? lines : [...lines.slice(0, room - 1), `… ${lines.length - room + 1} more failed: report ${report}`]
  return [...shown, verdict(run, report)]
}

/** The run's report file: the totals and every failure with its errors, so a failure is read without a rerun. */
export function lastRunReport(run: LastRun, finishedAt: string) {
  const { pending, ...sum } = totals(run)
  return {
    reason: run.reason,
    finishedAt,
    totals: pending > 0 ? { ...sum, unfinished: pending } : sum,
    failed: failures(run),
    unhandled: run.unhandled,
  }
}

function runError(error: SerializedError): RunError {
  const { name, message, stack, diff } = error as SerializedError & { diff?: string }
  return {
    ...(typeof name === 'string' && name !== 'Error' ? { name } : {}),
    message: String(message ?? ''),
    ...(typeof stack === 'string' ? { stack } : {}),
    ...(typeof diff === 'string' ? { diff } : {}),
  }
}

function runFile(module: TestModule): RunFile {
  const suiteErrors = [...module.children.allSuites()].flatMap(suite => suite.errors())
  return {
    file: module.relativeModuleId,
    errors: [...module.errors(), ...suiteErrors].map(runError),
    tests: [...module.children.allTests()].map(test => {
      const result = test.result()
      return { name: test.fullName, state: result.state, errors: (result.errors ?? []).map(runError) }
    }),
  }
}

/**
 * A reporter beside vitest's own (vitest.config.ts): writes `.temp/vitest-last.json` and prints {@link lastRunTail}
 * after vitest's summary, so a failure is named even in a cut output and a run whose exit code a pipe ate.
 */
export class LastRunReporter implements Reporter {
  private vitest: Vitest | undefined

  onInit(vitest: Vitest): void {
    this.vitest = vitest
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>, unhandled: ReadonlyArray<SerializedError>, reason: TestRunEndReason): void {
    if (this.vitest === undefined) return
    const run: LastRun = { reason, files: modules.map(runFile), unhandled: unhandled.map(runError) }
    const path = join(this.vitest.config.root, LAST_RUN_REPORT)
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(lastRunReport(run, new Date().toISOString()), null, 2)}\n`)
    } catch (error) {
      this.vitest.logger.error(`vitest: the report ${LAST_RUN_REPORT} was not written: ${String(error)}`)
    }
    this.vitest.logger.log(['', ...lastRunTail(run, LAST_RUN_REPORT)].join('\n'))
  }
}
