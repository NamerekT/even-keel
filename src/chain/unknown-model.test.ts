import { describe, expect, it } from 'vitest'
import { notice, NoticeError, type Notice } from '../notice/notice.js'
import { setup, task } from './dispatcher.fixture.js'

const unknown = (model: string) => notice('chain.unknownModel', { task: 'ABC-1', model, agent: 'Claude', account: 'Demo', known: ['sonnet'] })

describe('a pause on a model the account lacks', () => {
  it('lifts by itself once the model of the first task is one the account has', async () => {
    let refusal: Notice | undefined = unknown('sonet')
    const asked: string[] = []
    const c = setup({
      refuse: { 'ABC-1': new NoticeError(unknown('sonet')) },
      modelBlock: async (project, id) => {
        asked.push(`${project}/${id}`)
        return refusal
      },
    })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    expect(c.dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'chain.unknownModel' } })

    c.dispatcher.check()
    await c.dispatcher.idle()
    expect(asked).toContain('ABC/ABC-1')
    expect(c.dispatcher.state.active[0]?.paused).toBe(true)
    expect(c.launched).toEqual([])

    refusal = undefined
    delete c.refuse['ABC-1']
    c.dispatcher.check()
    await c.dispatcher.idle()
    expect(c.launched).toEqual(['ABC/ABC-1'])
    expect(c.dispatcher.state.active[0]).toMatchObject({ paused: false, error: null })
    expect(c.log.some((line) => line.includes('ABC goes on'))).toBe(true)
  })

  it('holds while another launch block remains', async () => {
    const block = notice('chain.packagesNotReady', { project: 'ABC', packages: ['x'] })
    let packages: Notice | undefined
    const c = setup({ refuse: { 'ABC-1': new NoticeError(unknown('sonet')) }, modelBlock: async () => undefined, blocked: () => packages })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    packages = block
    delete c.refuse['ABC-1']
    c.dispatcher.check()
    await c.dispatcher.idle()
    expect(c.launched).toEqual([])
    expect(c.dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'chain.unknownModel' } })
  })

  it('leaves other pauses to the user', async () => {
    const c = setup({ refuse: { 'ABC-1': new Error('claude: could not start ABC-1') }, modelBlock: async () => undefined })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    delete c.refuse['ABC-1']
    c.dispatcher.check()
    await c.dispatcher.idle()
    expect(c.launched).toEqual([])
    expect(c.dispatcher.state.active[0]?.paused).toBe(true)
  })
})
