// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkedTask, TaskLinks } from '../state.js'
import { Links } from './Links.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const task = (id: string): LinkedTask => ({ id, title: `Task ${id}`, lamp: 'ahead' })

let root: Root
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
})

async function render(links: TaskLinks, stack?: boolean) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(Links, { links, onCard: () => {}, stack })))
  return host
}

const kinds = (host: HTMLElement) => [...host.querySelectorAll('.links__count')].map((count) => count.className.replace(/^links__count links__count--/, ''))

describe('Links', () => {
  it('draws nothing for a task without links: a zero keeps no place', async () => {
    const host = await render({ blockers: [], dependents: [] })
    expect(host.innerHTML).toBe('')
  })

  it('draws only the counter that has tasks', async () => {
    expect(kinds(await render({ blockers: [task('A-1')], dependents: [] }))).toEqual(['blockers'])
    await act(async () => root.unmount())
    expect(kinds(await render({ blockers: [], dependents: [task('A-2'), task('A-3')] }))).toEqual(['dependents'])
  })

  it('puts the lock above the key in a stack', async () => {
    const host = await render({ blockers: [task('A-1')], dependents: [task('A-2')] }, true)
    expect(host.querySelector('.links')?.classList.contains('links--stack')).toBe(true)
    expect(kinds(host)).toEqual(['blockers', 'dependents'])
    expect(host.querySelector('.links__count--blockers .links__number')?.textContent).toBe('1')
  })
})
