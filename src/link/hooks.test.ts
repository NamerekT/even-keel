import { describe, expect, it } from 'vitest'
import { hookRouteOf } from './hooks.js'

describe('the routes a machine carries for its sessions’ hooks (BTN-1260)', () => {
  it('takes each route of the hooks with its method and names the session', () => {
    expect(hookRouteOf('GET', '/api/sessions/s-1/checkpoint')).toEqual({ path: '/api/sessions/s-1/checkpoint', session: 's-1' })
    expect(hookRouteOf('GET', '/api/sessions/s-1/note')?.session).toBe('s-1')
    expect(hookRouteOf('GET', '/api/sessions/s-1/check')?.session).toBe('s-1')
    expect(hookRouteOf('POST', '/api/sessions/s-1/check')?.session).toBe('s-1')
    expect(hookRouteOf('GET', '/api/sessions/s-1/standards')?.session).toBe('s-1')
    expect(hookRouteOf('POST', '/api/sessions/s-1/outsider')?.session).toBe('s-1')
    expect(hookRouteOf('GET', '/api/sessions/s-1/outsider')).toBeUndefined()
    expect(hookRouteOf('POST', '/api/sessions/s-1/mail')?.session).toBe('s-1')
    expect(hookRouteOf('POST', '/api/sessions/a%20b/permission')?.session).toBe('a b')
  })

  it('takes the calibration of a project with its query and no session', () => {
    expect(hookRouteOf('GET', '/api/projects/ABC/calibration?task=ABC-1')).toEqual({ path: '/api/projects/ABC/calibration?task=ABC-1' })
  })

  it('refuses another method, another route of the page and a path that names another host', () => {
    expect(hookRouteOf('POST', '/api/sessions/s-1/checkpoint')).toBeUndefined()
    expect(hookRouteOf('GET', '/api/sessions/s-1/mail')).toBeUndefined()
    expect(hookRouteOf('GET', '/api/sessions/s-1/constructor')).toBeUndefined()
    expect(hookRouteOf('GET', '/api/sessions/s-1')).toBeUndefined()
    expect(hookRouteOf('GET', '/api/state')).toBeUndefined()
    expect(hookRouteOf('POST', '/api/session/answer')).toBeUndefined()
    expect(hookRouteOf('GET', '//example.com/api/sessions/s-1/checkpoint')).toBeUndefined()
    expect(hookRouteOf('GET', 'api/sessions/s-1/checkpoint')).toBeUndefined()
    expect(hookRouteOf('GET', '/api/sessions/%E0%A4%A/checkpoint')).toBeUndefined()
  })
})
