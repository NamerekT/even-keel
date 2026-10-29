import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRolloutUsage, checkUsage } from './cli-check-support.js'
import { loadSamples, replaySample, sampleSummary } from './cli-samples.js'

const samples = loadSamples(join(import.meta.dirname, '../test/fixtures/cli'))
describe('recorded CLI formats', () => {
  it('has real question and answer captures for every provider', () => {
    for (const provider of ['claude', 'codex', 'opencode', 'copilot']) {
      const own = samples.filter((sample) => sample.provider === provider)
      expect(own.length, provider).toBeGreaterThan(0)
      for (const sample of own) {
        expect(sample.snapshots.map((snapshot) => snapshot.phase)).toEqual(['question', 'answer'])
        expect(sample.snapshots[0]!.expected.question).toBe(true)
        expect(sample.snapshots[0]!.expected.answer).toBe(false)
        expect(sample.snapshots[1]!.expected).toMatchObject({ checkpoint: 'answer.txt', answer: true, lastReply: true })
      }
    }
  })

  for (const [index, sample] of samples.entries()) {
    it(`${sample.provider} ${sample.version}, capture ${index}: summary and limits match the live expectations`, () => {
      expect(sample.contextWindow).toBeGreaterThan(0)
      for (const snapshot of sample.snapshots) {
        const actual = sampleSummary(replaySample(sample.provider, snapshot.raw))
        expect(actual, snapshot.phase).toEqual(snapshot.expected)
        if (sample.provider === 'codex') expect(actual.contextWindow).toBe(sample.contextWindow)
      }
      if (sample.usage !== undefined) {
        const raw = sample.snapshots.at(-1)!.raw
        const actual = sample.usage.answer === undefined && 'jsonl' in raw ? checkRolloutUsage(raw.jsonl) : checkUsage(sample.usage.answer!)
        expect(actual).toEqual(sample.usage.expected)
      }
    })

    it(`${sample.provider} ${sample.version}, capture ${index}: contains only fake identity fields`, () => {
      const text = JSON.stringify(sample)
      expect(text).not.toMatch(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/)
      for (const email of text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []) expect(email).toMatch(/@example\.com$/)
      expect(text).not.toMatch(/[a-z]:\\\\(?:Users|Projects|Windows)\\\\/i)
      expect(text).not.toMatch(/\/(?:home|Users)\//)
    })
  }
})
