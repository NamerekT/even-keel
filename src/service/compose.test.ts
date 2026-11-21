import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { SHUTDOWN_MS } from './defaults.js'

const FILES = ['compose.yaml', 'compose.machine.yaml', 'compose.hub-machine.yaml']

/** Compose's duration as milliseconds: `30s`, `1m30s`, `500ms`. */
function durationMs(value: string): number {
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)]
  expect(parts.map((part) => part[0]).join('')).toBe(value)
  const unit = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 } as const
  return parts.reduce((sum, [, amount, name]) => sum + Number(amount) * unit[name as keyof typeof unit], 0)
}

describe('compose files', () => {
  for (const file of FILES) {
    it(`${file} lets every service finish its shutdown before Docker kills it`, () => {
      const { services } = parse(readFileSync(file, 'utf8')) as { services: Record<string, { stop_grace_period?: string }> }
      for (const [name, service] of Object.entries(services)) {
        expect(service.stop_grace_period, `${file}: ${name}`).toBeTypeOf('string')
        expect(durationMs(service.stop_grace_period!), `${file}: ${name}`).toBeGreaterThan(SHUTDOWN_MS)
      }
    })
  }
})
