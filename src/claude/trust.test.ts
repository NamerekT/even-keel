import { describe, expect, it } from 'vitest'
import { fail, noticeOf } from '../notice/notice.js'
import { untrustedStart } from './trust.js'

const place = { task: 'GLS-4', folder: 'D:\\gls', platform: 'win32', user: 'svc' }
const refusal =
  'Workspace not trusted. Run claude in D:\\gls\\.claude\\worktrees\\gls-4 once and accept the trust prompt, then retry.'

describe('untrustedStart', () => {
  it("turns the CLI's refusal of an untrusted folder into a notice of its own, naming the project's folder (BTN-429)", () => {
    const error = fail('claude.startFailed', { task: 'GLS-4', cwd: 'D:\\gls\\.claude\\worktrees\\gls-4' }, { detail: `Error: ${refusal}\n` })
    expect(noticeOf(untrustedStart(error, place))).toEqual({ code: 'claude.untrusted', params: place })
  })

  it('leaves any other failure as it is', () => {
    expect(untrustedStart(fail('claude.startFailed', { task: 'GLS-4', cwd: 'D:\\gls' }, { detail: 'spawn ENOENT' }), place)).toBeNull()
    expect(untrustedStart(fail('claude.resumeFailed', { task: 'GLS-4', cwd: 'D:\\gls' }, { detail: refusal }), place)).toBeNull()
    expect(untrustedStart(new Error(refusal), place)).toBeNull()
  })
})
