import { describe, expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { AccessBook } from './book.js'
import { INVITE_MS, InviteDesk, MAX_INVITES, REISSUE_MS } from './invites.js'
import { tokensOf } from './store.js'

const PHONE = { device: 'Safari on iPhone', address: '100.64.0.12' }
const STRANGER = { device: 'Firefox on Linux', address: '198.51.100.20' }

async function deskOf() {
  const db = await memoryDatabase()
  let now = new Date('2026-11-24T10:00:00.000Z')
  const book = await AccessBook.load(db, { clock: () => now })
  let changes = 0
  const desk = new InviteDesk(db, book, { clock: () => now, changed: () => changes++, log: () => {}, waitMs: 50, digits: () => '47' })
  return { db, book, desk, changes: () => changes, later: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

describe('an invitation of a new device', () => {
  it('lets the device that opened the link in once a person lets it in, and only that browser gets the token', async () => {
    const { db, book, desk } = await deskOf()
    const made = await desk.create(null)
    const opened = await desk.open(made.secret, undefined, PHONE)
    expect(opened.view).toEqual({ state: 'waiting', digits: '47', expiresAt: made.expiresAt })
    expect(opened.claim).toEqual(expect.any(String))
    expect(await desk.live()).toEqual([{ id: made.id, createdAt: expect.any(String), expiresAt: made.expiresAt, opened: { device: PHONE.device, from: PHONE.address, at: expect.any(String), digits: '47' } }])
    expect(book.signInOn()).toBe(false)
    // The first "Let in" turns the sign-in on (BTN-1656).
    expect(await desk.admit(made.id)).toBe(true)
    expect(book.signInOn()).toBe(true)
    // The link and a wrong claim give no token: only the claiming browser's secret does.
    expect((await desk.open(made.secret, undefined, STRANGER)).signedIn).toBeUndefined()
    expect((await desk.wait('not-the-claim', STRANGER.address)).view).toEqual({ state: 'gone' })
    const answer = await desk.wait(opened.claim, PHONE.address)
    expect(answer.view).toEqual({ state: 'admitted', device: PHONE.device })
    expect(book.find(answer.signedIn!.secret)).toMatchObject({ device: PHONE.device, inviteId: made.id, keyMark: null })
    expect((await tokensOf(db, book.person)).map((token) => token.inviteId)).toEqual([made.id])
    // Once the token was presented, asking again gives no second one.
    book.seen(book.find(answer.signedIn!.secret)!, PHONE.address)
    expect(await desk.wait(opened.claim, PHONE.address)).toEqual({ view: { state: 'gone' } })
    expect(book.devices()).toHaveLength(1)
    expect(await desk.live()).toEqual([])
  })

  it('gives the same browser its sign-in again when the answer with the token never reached it, and leaves one device (BTN-1664)', async () => {
    const { book, desk, later } = await deskOf()
    const made = await desk.create(null)
    const claim = (await desk.open(made.secret, undefined, PHONE)).claim
    await desk.admit(made.id)
    // The phone's screen went dark: this answer, its token in a cookie, is lost on the way.
    const lost = await desk.wait(claim, PHONE.address)
    later(60_000)
    expect(await desk.wait('not-the-claim', STRANGER.address)).toEqual({ view: { state: 'gone' } })
    expect((await desk.open(made.secret, undefined, STRANGER)).signedIn).toBeUndefined()
    const again = await desk.wait(claim, PHONE.address)
    expect(again.view).toEqual({ state: 'admitted', device: PHONE.device })
    expect(again.signedIn!.secret).not.toBe(lost.signedIn!.secret)
    expect(book.find(lost.signedIn!.secret)).toBeUndefined()
    expect(book.devices().map((token) => token.id)).toEqual([again.signedIn!.token.id])
    // Opening the link again in the same browser does the same.
    const reopened = await desk.open(made.secret, claim, PHONE)
    expect(reopened.view.state).toBe('admitted')
    expect(book.devices().map((token) => token.id)).toEqual([reopened.signedIn!.token.id])
    book.seen(reopened.signedIn!.token, PHONE.address)
    expect((await desk.wait(claim, PHONE.address)).signedIn).toBeUndefined()
    expect(book.devices().map((token) => token.id)).toEqual([reopened.signedIn!.token.id])
  })

  it('gives the sign-in again only until the invitation ends, or for a short while after "Let in" when it ends sooner', async () => {
    const { book, desk, later } = await deskOf()
    const made = await desk.create(null)
    const claim = (await desk.open(made.secret, undefined, PHONE)).claim
    later(INVITE_MS - 1_000)
    await desk.admit(made.id)
    const lost = await desk.wait(claim, PHONE.address)
    later(REISSUE_MS - 1_000)
    const again = await desk.wait(claim, PHONE.address)
    expect(again.view.state).toBe('admitted')
    later(REISSUE_MS)
    expect(await desk.wait(claim, PHONE.address)).toEqual({ view: { state: 'gone' } })
    expect(book.find(lost.signedIn!.secret)).toBeUndefined()
    expect(book.find(again.signedIn!.secret)).toBeDefined()
  })

  it('gives one token when two tabs of the same browser ask at once after a lost answer', async () => {
    const { book, desk } = await deskOf()
    const made = await desk.create(null)
    const claim = (await desk.open(made.secret, undefined, PHONE)).claim
    await desk.admit(made.id)
    await desk.wait(claim, PHONE.address)
    const answers = await Promise.all([desk.wait(claim, PHONE.address), desk.wait(claim, PHONE.address)])
    const tokens = answers.flatMap((answer) => (answer.signedIn === undefined ? [] : [answer.signedIn.token.id]))
    expect(book.devices().map((token) => token.id)).toEqual([tokens.at(-1)])
    expect(tokens.length).toBeGreaterThanOrEqual(1)
  })

  it('goes to the first browser that opens it: the next one sees it used and nothing reaches the owner', async () => {
    const { desk, changes } = await deskOf()
    const made = await desk.create(null)
    const [one, two] = await Promise.all([desk.open(made.secret, undefined, PHONE), desk.open(made.secret, undefined, STRANGER)])
    expect([one.view.state, two.view.state].sort()).toEqual(['used', 'waiting'])
    const before = changes()
    expect((await desk.open(made.secret, undefined, STRANGER)).view).toEqual({ state: 'used' })
    expect(changes()).toBe(before)
    expect((await desk.live())[0]?.opened?.device).toBe(one.view.state === 'waiting' ? PHONE.device : STRANGER.device)
  })

  it('shows the same browser its own claim when it opens the link again', async () => {
    const { desk } = await deskOf()
    const made = await desk.create(null)
    const first = await desk.open(made.secret, undefined, PHONE)
    const again = await desk.open(made.secret, first.claim, PHONE)
    expect(again.view).toEqual(first.view)
    expect(again.claim).toBeUndefined()
  })

  it('lives ten minutes: an unopened link is then gone like a wrong one, an opened one expired', async () => {
    const { desk, later } = await deskOf()
    const unopened = await desk.create(null)
    const opened = await desk.create(null)
    const claim = (await desk.open(opened.secret, undefined, PHONE)).claim
    later(INVITE_MS)
    expect((await desk.open(unopened.secret, undefined, PHONE)).view).toEqual({ state: 'gone' })
    expect((await desk.open('a-link-that-never-was', undefined, PHONE)).view).toEqual({ state: 'gone' })
    expect((await desk.wait(claim, PHONE.address)).view).toEqual({ state: 'expired' })
    await expect(desk.admit(opened.id)).rejects.toMatchObject({ notice: { code: 'auth.inviteGone' } })
    expect(await desk.live()).toEqual([])
  })

  it('declined, the device sees it and gets no token; the link stays dead', async () => {
    const { desk } = await deskOf()
    const made = await desk.create(null)
    const claim = (await desk.open(made.secret, undefined, PHONE)).claim
    await desk.decline(made.id)
    const answer = await desk.wait(claim, PHONE.address)
    expect(answer).toEqual({ view: { state: 'declined' } })
    await expect(desk.admit(made.id)).rejects.toMatchObject({ notice: { code: 'auth.inviteGone' } })
  })

  it('cancelled, an unopened link is gone and an opened one says so to its device', async () => {
    const { desk } = await deskOf()
    const unopened = await desk.create(null)
    const opened = await desk.create(null)
    const claim = (await desk.open(opened.secret, undefined, PHONE)).claim
    await desk.cancel(unopened.id)
    await desk.cancel(opened.id)
    expect((await desk.open(unopened.secret, undefined, PHONE)).view).toEqual({ state: 'gone' })
    expect((await desk.wait(claim, PHONE.address)).view).toEqual({ state: 'cancelled' })
  })

  it('cannot be let in before anyone opened it', async () => {
    const { desk } = await deskOf()
    const made = await desk.create(null)
    await expect(desk.admit(made.id)).rejects.toMatchObject({ notice: { code: 'auth.inviteGone' } })
  })

  it('wakes a waiting device at once when a person decides', async () => {
    const { db, book } = await deskOf()
    const desk = new InviteDesk(db, book, { log: () => {}, waitMs: 10_000 })
    const made = await desk.create(null)
    const claim = (await desk.open(made.secret, undefined, PHONE)).claim
    const started = Date.now()
    const waiting = desk.wait(claim, PHONE.address)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await desk.admit(made.id)
    expect((await waiting).view.state).toBe('admitted')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('keeps at most a few waiting at once', async () => {
    const { desk } = await deskOf()
    for (let count = 0; count < MAX_INVITES; count++) await desk.create(null)
    await expect(desk.create(null)).rejects.toMatchObject({ notice: { code: 'auth.invitesFull' } })
  })

  it('tells of the change once more after the first "Let in" turned the sign-in on, so the page state shows it (BTN-1638)', async () => {
    const db = await memoryDatabase()
    const book = await AccessBook.load(db)
    const seen: boolean[] = []
    const desk = new InviteDesk(db, book, { changed: () => seen.push(book.signInOn()), log: () => {}, digits: () => '47' })
    const made = await desk.create(null)
    await desk.open(made.secret, undefined, PHONE)
    seen.length = 0
    await desk.admit(made.id)
    expect(seen.at(-1)).toBe(true)
  })
})
