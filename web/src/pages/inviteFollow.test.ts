import { describe, expect, it } from 'vitest'
import type { JoinView } from '../../../src/access/view.js'
import { fail, textNotice, NoticeError } from '../../../src/notice/notice.js'
import { followInvite, GIVE_UP_MS, type FollowDeps, type FollowStep } from './inviteFollow.js'

const WAITING: JoinView = { state: 'waiting', digits: '47', expiresAt: '2026-11-25T10:10:00.000Z' }
const lost = () => new TypeError('Failed to fetch')

/** A follow over scripted answers: each call takes the next one, an Error is thrown; the clock moves only in pauses. */
function scripted(answers: (JoinView | Error)[], options: { visible?: () => boolean; device?: string | Error } = {}) {
  const asked: string[] = []
  const steps: FollowStep[] = []
  const pauses: number[] = []
  let clock = 0
  const run = { deps: undefined as unknown as FollowDeps, asked, steps, pauses, checks: 0 }
  run.deps = {
    device: async () => {
      run.checks += 1
      if (options.device instanceof Error) throw options.device
      return options.device ?? null
    },
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
  return run
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

  it('takes `gone` after a lost link for the sign-in it is when the lost answer brought this browser its token', async () => {
    const run = scripted([WAITING, lost(), { state: 'gone' }], { device: 'Chrome on Android' })
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'admitted', device: 'Chrome on Android' })
    expect(run.steps.at(-1)).toEqual({ at: 'view', view: { state: 'admitted', device: 'Chrome on Android' } })
    expect(run.checks).toBe(1)
  })

  it('takes `used` after a lost open for the sign-in too', async () => {
    const run = scripted([lost(), { state: 'used' }], { device: 'Safari on iPhone' })
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'admitted', device: 'Safari on iPhone' })
  })

  it('checks the sign-in on "Try again", which waits on the claim the earlier asking took', async () => {
    const run = scripted([{ state: 'gone' }], { device: 'Chrome on Android' })
    expect(await followInvite('auth/invite/wait', run.deps)).toEqual({ state: 'admitted', device: 'Chrome on Android' })
  })

  it('keeps `gone` after a lost link when this browser has no sign-in of its own, or the check fails', async () => {
    const none = scripted([WAITING, lost(), { state: 'gone' }])
    expect(await followInvite('auth/invite/open', none.deps)).toEqual({ state: 'gone' })
    expect(none.checks).toBe(1)
    const failed = scripted([WAITING, lost(), { state: 'gone' }], { device: lost() })
    expect(await followInvite('auth/invite/open', failed.deps)).toEqual({ state: 'gone' })
  })

  it('does not check the sign-in for `used` or `gone` with no lost link before', async () => {
    const run = scripted([{ state: 'used' }], { device: 'Chrome on Android' })
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'used' })
    expect(run.checks).toBe(0)
  })

  it('takes an answer without a state as a lost link', async () => {
    const run = scripted([WAITING, null as unknown as JoinView, { state: 'declined' }])
    expect(await followInvite('auth/invite/open', run.deps)).toEqual({ state: 'declined' })
  })
})
