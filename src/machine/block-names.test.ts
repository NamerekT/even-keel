import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { namedBlock } from './block-names.js'

const machine = { id: 'm-1', name: 'Example box', own: false }
const missing = (downloading: boolean) => notice('agent.copyMissing', { title: 'Claude Code', agent: 'claude', downloading })

describe('a machine\'s launch block on the hub', () => {
  it('names the machine an account is absent on', () => {
    const block = notice('machines.accountAbsent', { account: 'john.doe@example.com', machine: '', name: '' })
    expect(namedBlock(block, machine, [])).toEqual(notice('machines.accountAbsent', { account: 'john.doe@example.com', machine: 'm-1', name: 'Example box' }))
  })

  it('keeps the own machine\'s missing copy, which the hub\'s page downloads', () => {
    expect(namedBlock(missing(false), { ...machine, own: true }, [])).toEqual(missing(false))
  })

  it('tells a machine elsewhere downloading its copy from one waiting for the hub\'s consent or failed (BTN-1516)', () => {
    const named = (block: ReturnType<typeof missing>, consents: string[]) => namedBlock(block, machine, consents)
    expect(named(missing(true), [])).toEqual(notice('machines.copyMissing', { title: 'Claude Code', agent: 'claude', machine: 'm-1', name: 'Example box', state: 'downloading' }))
    expect(named(missing(false), []).params).toMatchObject({ state: 'consent' })
    expect(named(missing(false), ['claude']).params).toMatchObject({ state: 'failed' })
  })

  it('leaves every other block as it is', () => {
    const other = notice('pool.noGit', {})
    expect(namedBlock(other, machine, [])).toBe(other)
    expect(namedBlock(undefined, machine, [])).toBeUndefined()
  })
})
