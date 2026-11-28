// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { LiveProvider } from '../live/context.js'
import { createFakeSource } from '../live/fake.js'
import type { ChainBlock } from '../state.js'
import { MachineTag } from '../ui/MachineTag.js'
import { PinWaitChip } from './PinWaitChip.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

async function draw(element: ReactElement): Promise<HTMLElement> {
  const source = createFakeSource('?chain=pins&delay=0')
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, null, createElement(LiveProvider, { source, children: element }))))
  return host
}

const laptop = [{ id: 'machine-1', name: 'Laptop' }]
const wait = (why: NonNullable<ChainBlock['pinWait']>['why']) => ({ why, machines: ['Laptop'] })

describe('a pinned task waiting for its machines (BTN-1807)', () => {
  it.each(['busy', 'offline'] as const)('draws no chip for %s: the reason is in the tag', async (why) => {
    const host = await draw(createElement(PinWaitChip, { wait: wait(why), onOpen: () => {} }))
    expect(host.innerHTML).toBe('')
  })

  it("puts a busy machine's reason into the tag's tip and keeps the tag as it is", async () => {
    const host = await draw(createElement(MachineTag, { machines: laptop, pinned: true, wait: 'busy' }))
    const tag = host.querySelector<HTMLElement>('.machine-tag')!
    expect(tag.title).toContain(t.chain.machinesPinned)
    expect(tag.title).toContain(t.chain.pinWait.busy)
    expect(tag.classList.contains('machine-tag--offline')).toBe(false)
  })

  it('dims the tag of a machine off the link, the reason in its tip', async () => {
    const host = await draw(createElement(MachineTag, { machines: laptop, pinned: true, wait: 'offline' }))
    const tag = host.querySelector<HTMLElement>('.machine-tag')!
    expect(tag.title).toContain(t.chain.pinWait.offline)
    expect(tag.classList.contains('machine-tag--offline')).toBe(true)
  })

  it.each(['gone', 'elsewhere'] as const)('keeps %s a button that opens the card', async (why) => {
    const opened = vi.fn()
    const host = await draw(createElement(PinWaitChip, { wait: wait(why), onOpen: opened }))
    const button = host.querySelector<HTMLButtonElement>('button.block__pin')
    expect(button).not.toBeNull()
    await act(async () => button!.click())
    expect(opened).toHaveBeenCalledOnce()
  })
})
