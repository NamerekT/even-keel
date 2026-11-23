import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVitest } from 'vitest/node'
import { TIMED_OUT, slowRunnerConfig, slowness } from './slow-runner.js'

const ROOT = join(import.meta.dirname, '..')

describe('slowness', () => {
  it('is 1 without the variable and its factor with it', () => {
    expect(slowness({})).toBe(1)
    expect(slowness({ E2E_SLOW_RUNNER: '' })).toBe(1)
    expect(slowness({ E2E_SLOW_RUNNER: '2' })).toBe(2)
    expect(slowness({ E2E_SLOW_RUNNER: ' 1.5 ' })).toBe(1.5)
  })

  it('refuses a factor that would shorten a timeout or is no number', () => {
    expect(() => slowness({ E2E_SLOW_RUNNER: '0.5' })).toThrow('E2E_SLOW_RUNNER=0.5')
    expect(() => slowness({ E2E_SLOW_RUNNER: 'yes' })).toThrow('E2E_SLOW_RUNNER=yes')
  })
})

describe('slowRunnerConfig', () => {
  it('changes nothing without the variable: no retry, the default timeouts', () => {
    expect(slowRunnerConfig({})).toEqual({})
  })

  it('scales the default timeouts and retries once on a timeout on a slow runner', () => {
    expect(slowRunnerConfig({ E2E_SLOW_RUNNER: '2' })).toEqual({ testTimeout: 10_000, hookTimeout: 20_000, retry: { count: 1, condition: TIMED_OUT } })
  })
})

describe('the retry of a slow runner', () => {
  // A vitest of its own on a sample, so that the retries and failures it shows are not this run's own.
  it('runs once more a test past its timeout or its hook\'s, never one that failed an assertion or threw', { timeout: 60_000 }, async () => {
    const exitCode = process.exitCode
    const vitest = await createVitest('test', {
      config: false,
      root: ROOT,
      include: ['test/slow-runner.sample.ts'],
      watch: false,
      reporters: [],
      ...slowRunnerConfig({ E2E_SLOW_RUNNER: '2' }),
    })
    try {
      await vitest.start()
      const tests = vitest.state.getTestModules().flatMap((module) => [...module.children.allTests()])
      expect(Object.fromEntries(tests.map((test) => [test.name, { state: test.result().state, retries: test.diagnostic()?.retryCount }]))).toEqual({
        'times out once': { state: 'passed', retries: 1 },
        'times out once in its hook': { state: 'passed', retries: 1 },
        'fails an assertion the first time': { state: 'failed', retries: 0 },
        'throws the first time': { state: 'failed', retries: 0 },
      })
    } finally {
      await vitest.close()
      // The sample's failures are expected: they must not fail this run.
      process.exitCode = exitCode
    }
  })

  it('does not take an assertion, an exception or a harness wait for a timeout', () => {
    let assertion = ''
    try {
      expect(1).toBe(2)
    } catch (error) {
      assertion = (error as Error).message
    }
    expect(assertion).not.toBe('')
    expect(TIMED_OUT.test(assertion)).toBe(false)
    expect(TIMED_OUT.test("Cannot read properties of undefined (reading 'id')")).toBe(false)
    expect(TIMED_OUT.test('e2e: the chain of ABC started did not happen in 300 s of the service\'s time')).toBe(false)
    expect(TIMED_OUT.test('expected "Test timed out in 5000ms." to be "x"')).toBe(false)
    expect(TIMED_OUT.test('Test timed out in 60000ms while waiting for expect.poll.\nIf this is a long-running test, …')).toBe(true)
  })
})

describe('the timeouts of the e2e scenarios', () => {
  it('all go through scaled, so a slow runner stretches every one of them', () => {
    // The disk, not import.meta.glob: vitest's module cache would freeze the list of files.
    const folder = join(import.meta.dirname, '..', 'src', 'e2e')
    const bare = readdirSync(folder).filter((name) => name.endsWith('.ts')).flatMap((name) =>
      readFileSync(join(folder, name), 'utf8').split('\n').flatMap((line, index) =>
        /timeout: \d|^\s*\}, \d[\d_]*\)\s*$/.test(line) ? [`src/e2e/${name}:${index + 1}: ${line.trim()}`] : []))
    expect(bare).toEqual([])
  })
})
