import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountLogin } from '../../src/account/model.js'
import { NO_SIGN_IN, SIGN_INS } from '../../src/agent/providers.js'
import { notice } from '../../src/notice/notice.js'
import { addDepth, addOf, dirty, freshKeys, HUB_PLACE, legacyAdd, loginRow, onToken, placeOf, planRefused, retryBody, sameChoices, signsOf, tokenBody, wayGiven, WAYS, withAdd, withoutAdd, withPlace } from './accountAdd.js'
import { PROVIDERS } from './accounts.js'

const search = (text: string) => new URLSearchParams(text)

describe('WAYS', () => {
  it('offers every sign-in method of the service and nothing else', () => {
    for (const provider of PROVIDERS) {
      const methods = WAYS[provider].flatMap((way) => (way.method === undefined ? [] : [way.method]))
      expect(methods).toEqual(SIGN_INS[provider] === undefined ? [] : [...SIGN_INS[provider]])
    }
  })

  it('adds a folder at once only for the ways that need no sign-in', () => {
    const instant = PROVIDERS.flatMap((provider) => WAYS[provider].filter((way) => way.kind === 'instant').map((way) => `${provider}:${way.id}`))
    expect(instant).toEqual(['opencode:free', 'copilot:machine'])
    for (const provider of PROVIDERS) for (const way of WAYS[provider]) expect(way.kind === 'instant').toBe(way.method === NO_SIGN_IN)
  })

  it('has a key way for every provider and no Agent SDK', () => {
    for (const provider of PROVIDERS) expect(WAYS[provider].filter((way) => way.kind === 'key')).toHaveLength(provider === 'opencode' ? 2 : 1)
    expect(WAYS.opencode.filter(way => way.kind === 'key').map(way => way.id)).toEqual(['go', 'apiKey'])
    expect(PROVIDERS.flatMap((provider) => WAYS[provider].map((way) => way.id))).not.toContain('sdk')
  })
})

describe('addOf', () => {
  it('is closed without the parameter', () => {
    expect(addOf(search(''))).toBeNull()
    expect(addOf(search('step=agent'))).toBeNull()
  })

  it("stays closed on the add dialog of /tools (BTN-629)", () => {
    expect(addOf(search('projects=A&add=huly%40even-keel'))).toBeNull()
    expect(addOf(search('add=&way=apiKey'))).toBeNull()
  })

  it('opens on the provider pick when the provider is not given or not known', () => {
    expect(addOf(search('addAccount='))).toEqual({ provider: null, way: null })
    expect(addOf(search('addAccount'))).toEqual({ provider: null, way: null })
    expect(addOf(search('addAccount=gemini&addWay=apiKey'))).toEqual({ provider: null, way: null })
  })

  it("takes the provider's way, its first when not given or not its own", () => {
    expect(addOf(search('addAccount=codex&addWay=apiKey'))).toEqual({ provider: 'codex', way: WAYS.codex[1] })
    expect(addOf(search('addAccount=codex'))).toEqual({ provider: 'codex', way: WAYS.codex[0] })
    expect(addOf(search('addAccount=claude&addWay=machine'))).toEqual({ provider: 'claude', way: WAYS.claude[0] })
    expect(addOf(search('addAccount=opencode&addWay=free'))?.way?.id).toBe('free')
  })
})

describe('wayGiven', () => {
  it('tells a way picked in the address, which skips the offer of the CLI sign-in on the machine', () => {
    expect(wayGiven(search(withAdd('?step=agent', 'claude', 'subscription')))).toBe(true)
    expect(wayGiven(search(withAdd('?step=agent', 'claude')))).toBe(false)
    expect(wayGiven(search('addAccount=claude&way=subscription'))).toBe(false)
  })
})

describe('withAdd', () => {
  it("opens the dialog over the page's own address, keeping its parameters", () => {
    expect(withAdd('?step=agent&projects=none', 'codex')).toBe('?step=agent&projects=none&addAccount=codex')
    expect(withAdd('', 'claude', 'apiKey')).toBe('?addAccount=claude&addWay=apiKey')
    expect(withAdd('', null)).toBe('?addAccount=')
  })

  it('replaces a way of another step', () => {
    expect(withAdd('?addAccount=claude&addWay=apiKey', null)).toBe('?addAccount=')
    expect(withAdd('?addAccount=claude&addWay=apiKey', 'claude', 'subscription')).toBe('?addAccount=claude&addWay=subscription')
  })

  it("closes back to the page's own address", () => {
    expect(withoutAdd('?step=agent&addAccount=codex&addWay=apiKey')).toBe('?step=agent')
    expect(withoutAdd('?addAccount=')).toBe('')
  })

  it("leaves the add dialog of /tools alone (BTN-629)", () => {
    expect(withAdd('?projects=A&add=huly%40even-keel', null)).toBe('?projects=A&add=huly%40even-keel&addAccount=')
    expect(withoutAdd('?projects=A&add=huly%40even-keel&addAccount=codex&addWay=apiKey')).toBe('?projects=A&add=huly%40even-keel')
  })
})

describe('where the account is added (BTN-1308)', () => {
  it('is not picked until the first step sets it, and the later steps keep it', () => {
    expect(placeOf(search('addAccount='))).toBeNull()
    expect(placeOf(search('addAccount=&addOn='))).toBeNull()
    expect(withPlace('?machine=machine-1&addAccount=', 'machine-1')).toBe('?machine=machine-1&addAccount=&addOn=machine-1')
    expect(placeOf(search(withPlace('?addAccount=', HUB_PLACE)))).toBe(HUB_PLACE)
    expect(placeOf(search(withAdd(withPlace('?addAccount=', HUB_PLACE), 'codex')))).toBe(HUB_PLACE)
  })

  it('goes with the dialog', () => {
    expect(withoutAdd('?machine=machine-1&addAccount=&addOn=machine-1')).toBe('?machine=machine-1')
  })
})

describe('legacyAdd', () => {
  it('sends the old add page to the accounts list with the dialog open', () => {
    expect(legacyAdd(search(''))).toBe('/accounts?addAccount=')
    expect(legacyAdd(search('provider=codex&back=%2Fsetup%3Fstep%3Dagent'))).toBe('/accounts?addAccount=codex')
  })

  it("takes its connection as the provider's way", () => {
    expect(legacyAdd(search('provider=claude&connection=apiKey'))).toBe('/accounts?addAccount=claude&addWay=apiKey')
    expect(legacyAdd(search('provider=copilot&connection=apiKey'))).toBe('/accounts?addAccount=copilot&addWay=token')
    expect(legacyAdd(search('provider=opencode&connection=cli'))).toBe('/accounts?addAccount=opencode')
    expect(legacyAdd(search('provider=opencode&connection=apiKey'))).toBe('/accounts?addAccount=opencode&addWay=apiKey')
    expect(legacyAdd(search('provider=gemini&connection=apiKey'))).toBe('/accounts?addAccount=')
  })
})

describe('dirty', () => {
  it('is what a person typed: a name or a key, not a picked way', () => {
    expect(dirty({})).toBe(false)
    expect(dirty({ claude: { name: ' ', key: '', way: 'apiKey' } })).toBe(false)
    expect(dirty({ claude: { name: '', key: '', way: 'apiKey' }, codex: { name: '', key: 'sk-x', way: 'apiKey' } })).toBe(true)
    expect(dirty({ copilot: { name: 'work', key: '', way: 'token' } })).toBe(true)
    expect(dirty({ claude: { name: '', key: '', way: 'subscription', sign: 'token', sameAs: 'main' } })).toBe(false)
    expect(dirty({ claude: { name: '', key: '', way: 'subscription', sign: 'token', token: 'sk-ant-oat01-x' } })).toBe(true)
  })
})

describe('the long token of a Claude subscription (BTN-1005)', () => {
  const subscription = WAYS.claude[0]!
  const draft = { name: '', key: '', way: 'subscription' }
  const folder = (key: string, patch: Partial<AccountEntry> = {}) => ({ key, agent: 'claude', apiKey: false, needsLogin: false, ...patch }) as AccountEntry

  it('is offered for a Claude subscription only, the full sign-in being the default', () => {
    expect(signsOf('claude', subscription)).toBe(true)
    expect(signsOf('claude', WAYS.claude[1]!)).toBe(false)
    expect(signsOf('codex', WAYS.codex[0]!)).toBe(false)
    expect(onToken('claude', subscription, draft)).toBe(false)
    expect(onToken('claude', subscription, { ...draft, sign: 'full' })).toBe(false)
    expect(onToken('claude', subscription, { ...draft, sign: 'token' })).toBe(true)
    expect(onToken('claude', WAYS.claude[1]!, { ...draft, sign: 'token' })).toBe(false)
  })

  it('can be said to be of a Claude folder with a full sign-in that is signed in', () => {
    const accounts = [
      folder('main'),
      folder('out', { needsLogin: true }),
      folder('api', { apiKey: true }),
      folder('cloud', { cloud: { cloud: 'bedrock' } as never }),
      folder('spare', { longToken: { until: null } }),
      folder('codex', { agent: 'codex' }),
    ]
    expect(sameChoices(accounts).map((entry) => entry.key)).toEqual(['main'])
  })

  it('sends the name, the token and the folder picked, while that folder is still there', () => {
    const typed = { ...draft, name: 'Spare', token: 'sk-ant-oat01-x', sameAs: 'main' }
    expect(tokenBody(typed, [folder('main')])).toEqual({ name: 'Spare', token: 'sk-ant-oat01-x', sameAs: 'main' })
    expect(tokenBody(typed, [])).toEqual({ name: 'Spare', token: 'sk-ant-oat01-x' })
    expect(tokenBody(draft, [folder('main')])).toEqual({ name: '', token: '' })
  })
})

const login = (patch: Partial<AccountLogin> = {}): AccountLogin => ({
  agent: 'claude',
  target: null,
  startedAt: '2026-10-24T10:00:00.000Z',
  urls: ['https://claude.example.com/oauth'],
  deviceCode: null,
  output: '',
  error: null,
  codeSent: false,
  ...patch,
})

describe('loginRow', () => {
  it('waits on the link until it comes and is opened', () => {
    expect(loginRow(login({ urls: [] }), { opened: true, coding: false })).toBe('open')
    expect(loginRow(login(), { opened: false, coding: false })).toBe('open')
  })

  it('goes on to the sign-in once the link is opened, then to the code', () => {
    expect(loginRow(login(), { opened: true, coding: false })).toBe('signIn')
    expect(loginRow(login(), { opened: true, coding: true })).toBe('code')
    expect(loginRow(login({ codeSent: true }), { opened: true, coding: false })).toBe('code')
  })

  it('takes the code as the step when it was copied before the link was opened', () => {
    expect(loginRow(login({ agent: 'codex', deviceCode: 'ABCD-1234' }), { opened: false, coding: true })).toBe('code')
  })

  it('takes the link of this computer alone as the link (BTN-1292)', () => {
    expect(loginRow(login({ urls: [], localUrl: 'https://claude.example.com/oauth/authorize?local' }), { opened: true, coding: false })).toBe('signIn')
  })
})

describe('freshKeys', () => {
  it('is the accounts that came since the mark, none without one', () => {
    expect(freshKeys(new Set(['work', 'home']), ['work', 'home', 'richard.roe'])).toEqual(['richard.roe'])
    expect(freshKeys(new Set(['work']), ['work'])).toEqual([])
    expect(freshKeys(null, ['work'])).toEqual([])
  })
})

describe('addDepth', () => {
  it('counts the entries the dialog pushed, none for an address opened as it is', () => {
    expect(addDepth({ adding: 2 })).toBe(2)
    expect(addDepth(null)).toBe(0)
    expect(addDepth({ adding: 'x' })).toBe(0)
    expect(addDepth({ adding: -1 })).toBe(0)
  })
})

describe('retryBody', () => {
  it("starts the same sign-in again, by the method it was started with", () => {
    expect(retryBody(login())).toEqual(['account/add', { agent: 'claude' }])
    expect(retryBody(login({ agent: 'opencode', method: 'copilot' }))).toEqual(['account/add', { agent: 'opencode', method: 'copilot' }])
    expect(retryBody(login({ target: 'work' }))).toEqual(['account/renew', { account: 'work' }])
  })
})

describe('planRefused', () => {
  it('tells a sign-in refused for its plan after the CLI signed in from a failed one', () => {
    expect(planRefused(login({ agent: 'codex', error: notice('account.secondFree', { account: 'john@example.com' }) }))).toBe(true)
    expect(planRefused(login({ agent: 'codex', error: notice('account.sameFree', { account: 'john@example.com' }) }))).toBe(true)
    expect(planRefused(login({ error: notice('login.timeout', { minutes: 5 }) }))).toBe(false)
    expect(planRefused(login())).toBe(false)
  })
})
