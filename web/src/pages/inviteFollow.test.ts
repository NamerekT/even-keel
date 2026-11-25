import { describe, expect, it } from 'vitest'
import type { JoinView } from '../../../src/access/view.js'
import { fail, textNotice, NoticeError } from '../../../src/notice/notice.js'
import { followInvite, GIVE_UP_MS, type FollowDeps, type FollowStep } from './inviteFollow.js'

const WAITING: JoinView = { state: 'waiting', digits: '47', expiresAt: '2026-11-25T10:10:00.000Z' }
const lost = () => new TypeError('Failed to fetch')

/** A follow over scripted answers: each call takes the next one, an Error is thrown; the clock moves only in pauses. */
function scripted(answers: (JoinView | Error)[], options: { visible?: () => boolean } = {}) {
  const asked: string[] = []
  const steps: FollowStep[] = []
  const pauses: number[] = []
  let clock = 0
  const deps: FollowDeps = {
    link: 'secret',
    post: async <T,>(name: string, body: object) => {
      asked.push(`${name} ${JSON.stringify(body)}`)
      const next = answers.shift()
      if (next === undefined) throw new Error('no more answers')
      if (next instanceof Error) throw next
      return next as T
    },
    pause: async (ms) => {
      pauses.push(ms)
      clock += ms
    },
    visible: options.visible ?? (() => true),
    now: () => clock,
    show: (step) => steps.push(step),
  }
  return { deps, asked, steps, pauses }
}

describe('followInvite', () => {
  it('asks again after a lost link mid-wait and comes to the decline by itself', async () => {
    const run = scripted([WAITING, WAITING, lost(), { state: 'declined' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'declined' })
    expect(run.asked).toEqual(['auth/invite/open {"link":"secret"}', 'auth/invite/wait {}', 'auth/invite/wait {}', 'auth/invite/wait {}'])
    expect(run.steps.map((step) => step.at)).toEqual(['view', 'view', 'trouble', 'view'])
    expect(run.steps.at(-1)).toEqual({ at: 'view', view: { state: 'declined' } })
  })

  it('comes to the admission after several lost links, pausing longer each time', async () => {
    const run = scripted([WAITING, lost(), lost(), lost(), { state: 'admitted', device: 'Chrome on Android' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'admitted', device: 'Chrome on Android' })
    expect(run.pauses).toEqual([1000, 2000, 4000])
  })

  it('takes an answer the proxy made, not the hub, as a lost link too', async () => {
    const run = scripted([WAITING, new NoticeError(textNotice('/api/auth/invite/wait answered 502')), { state: 'cancelled' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'cancelled' })
  })

  it('repeats the open itself when the first request is lost: no claim yet to wait for', async () => {
    const run = scripted([lost(), WAITING, { state: 'expired' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'expired' })
    expect(run.asked).toEqual(['auth/invite/open {"link":"secret"}', 'auth/invite/open {"link":"secret"}', 'auth/invite/wait {}'])
    expect(run.steps[0]).toEqual({ at: 'trouble' })
  })

  it("stops on the hub's own refusal with its notice", async () => {
    const run = scripted([WAITING, fail('auth.inviteSlowDown', {})])
    expect(await followInvite('auth/invite/open', run.deps)).toBeNull()
    expect(run.steps.at(-1)).toEqual({ at: 'failed', notice: { code: 'auth.inviteSlowDown', params: {} } })
  })

  it('gives up with a coded notice once the link stays lost for a while on a page in view', async () => {
    const run = scripted([WAITING, ...Array.from({ length: 30 }, lost)])
    expect(await followInvite('auth/invite/open', run.deps)).toBeNull()
    expect(run.steps.at(-1)).toEqual({ at: 'failed', notice: { code: 'auth.inviteNoAnswer', params: {} } })
    expect(run.pauses.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(GIVE_UP_MS)
  })

  it('does not give up while the page is out of view: a phone with its screen off keeps waiting', async () => {
    const run = scripted([WAITING, ...Array.from({ length: 20 }, lost), { state: 'declined' }], { visible: () => false })
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'declined' })
  })

  it('starts the pauses over after an answer', async () => {
    const run = scripted([WAITING, lost(), lost(), WAITING, lost(), { state: 'declined' }])
    await followInvite('auth/invite/open', run.deps)
    expect(run.pauses).toEqual([1000, 2000, 1000])
  })

  it('takes an answer without a state as a lost link', async () => {
    const run = scripted([WAITING, null as unknown as JoinView, { state: 'declined' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'declined' })
  })
})
