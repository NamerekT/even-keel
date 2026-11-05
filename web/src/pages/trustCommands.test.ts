import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { notice, type Notice } from '../../../src/notice/notice.js'
import { UntrustedCommands } from './TrustCommands.js'

const place = { task: 'ABC-5', folder: 'D:/work/my repo', platform: 'win32', user: 'svc', service: false }
const render = (error: Notice | null) => renderToStaticMarkup(createElement(UntrustedCommands, { notice: error }))

describe('manual trust recovery', () => {
  it('shows a copyable cmd command only for a CLI trust refusal', () => {
    const html = render(notice('claude.untrusted', place))
    expect(html).toContain('pushd &quot;D:/work/my repo&quot; &amp;&amp; claude')
    expect(html).not.toContain('runas')
    expect(render(notice('claude.trustWriteFailed', { folder: place.folder }))).toBe('')
    expect(render(notice('claude.startFailed', { task: place.task, cwd: place.folder }))).toBe('')
    expect(render(null)).toBe('')
  })

  it('includes the service user command and preserves the legacy service fallback', () => {
    expect(render(notice('claude.untrusted', { ...place, service: true }))).toContain('runas /user:svc')
    const { service: _, ...legacy } = place
    expect(render(notice('claude.untrusted', legacy))).toContain('runas /user:svc')
  })

  it('finds refusals in stored nested causes and items', () => {
    const refusal = notice('claude.untrusted', place)
    const wrapper = notice('chain.empty', { project: 'ABC' }, { cause: refusal })
    expect(render(wrapper)).toBe(render(refusal))
    expect(render(notice('chain.empty', { project: 'ABC' }, { items: [wrapper] }))).toBe(render(refusal))
    expect(render(JSON.parse(JSON.stringify(wrapper)))).toBe(render(wrapper))
  })

  it.each(['linux', 'darwin'])('quotes shell paths and service users on %s', (platform) => {
    const html = render(notice('claude.untrusted', { ...place, platform, folder: "/work/team's repo", service: true }))
    expect(html).toContain('sudo -u &#x27;svc&#x27; -H claude')
    expect(html).toContain('team&#x27;\\&#x27;&#x27;s repo')
    expect(html).not.toContain('runas')
  })
})
