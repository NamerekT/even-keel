import { beforeEach, describe, expect, it } from 'vitest'

// Run only by test/slow-runner.test.ts, in a vitest of its own with the retry of a slow runner; `npm test` never picks it up.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let testAttempts = 0
it('times out once', { timeout: 50 }, async () => {
  testAttempts += 1
  if (testAttempts === 1) await sleep(300)
})

describe('a hook', () => {
  let hookAttempts = 0
  beforeEach(async () => {
    hookAttempts += 1
    if (hookAttempts === 1) await sleep(300)
  }, 50)

  it('times out once in its hook', () => {})
})

let assertionAttempts = 0
it('fails an assertion the first time', () => {
  assertionAttempts += 1
  expect(assertionAttempts).toBe(2)
})

let exceptionAttempts = 0
it('throws the first time', () => {
  exceptionAttempts += 1
  if (exceptionAttempts === 1) throw new Error('boom')
})
