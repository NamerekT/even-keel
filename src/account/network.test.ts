import { describe, expect, it } from 'vitest'
import { providerUrl, Reachability } from './network.js'

function reachabilityOf(answers: boolean[]) {
  let now = 0
  const probes: string[] = []
  const changes: string[] = []
  const reach = new Reachability({
    probe: async (url) => {
      probes.push(url)
      return answers.shift()!
    },
    ttlMs: 30_000,
    now: () => now,
    onChange: (url, up) => changes.push(`${url} ${up ? 'up' : 'down'}`),
  })
  return { reach, probes, changes, pass: (ms: number) => void (now += ms) }
}

describe('Reachability', () => {
  it('asks a provider at most once per ttl, and calls asked together share one probe', async () => {
    const { reach, probes, pass } = reachabilityOf([true, false])
    expect(await Promise.all([reach.up('https://a.example.com'), reach.up('https://a.example.com')])).toEqual([true, true])
    pass(29_000)
    expect(await reach.up('https://a.example.com')).toBe(true)
    pass(2_000)
    expect(await reach.up('https://a.example.com')).toBe(false)
    expect(probes).toEqual(['https://a.example.com', 'https://a.example.com'])
  })

  it('tells when a provider stops and starts answering, not that it answers at first', async () => {
    const { reach, changes, pass } = reachabilityOf([true, false, false, true])
    for (let i = 0; i < 4; i++) {
      await reach.up('https://a.example.com')
      pass(31_000)
    }
    expect(changes).toEqual(['https://a.example.com down', 'https://a.example.com up'])
  })

  it('takes the API of the account agent', () => {
    expect(providerUrl('claude')).toBe('https://api.anthropic.com')
    expect(providerUrl('codex')).toBe('https://api.openai.com')
  })
})
