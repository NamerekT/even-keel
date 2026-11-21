import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { t } from '../i18n/index.js'
import type { ChainWait } from '../waits.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { StatusChip } from '../ui/StatusChip.js'
import { WorkChip } from '../ui/WorkChip.js'
import { ArchiveCounts, HiddenCount } from './ChainDivider.js'

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

describe('the chain and the home page glue no facts with a dot (BTN-1374)', () => {
  it("gives the archive's tasks and fixes a mark each, the words in its title", () => {
    const markup = html(createElement(ArchiveCounts, { tasks: 4, fixes: 1 }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('<span class="count-badge">4</span>')
    expect(markup).toContain('<span class="count-badge">1</span>')
    expect(markup).toContain(`title="${t.chain.tasks(4)}"`)
    expect(markup).toContain(`title="${t.chain.fixes(1)}"`)
  })

  it('leaves a kind with none out of the archive', () => {
    const markup = html(createElement(ArchiveCounts, { tasks: 3, fixes: 0 }))
    expect(markup.match(/count-badge/g)).toHaveLength(1)
  })

  it("counts a folded milestone's tasks under the hidden mark", () => {
    const markup = html(createElement(HiddenCount, { tasks: 3 }))
    expect(markup).toContain('<span class="count-badge">3</span>')
    expect(markup).toContain(`aria-label="${t.chain.hidden(t.chain.tasks(3))}"`)
  })

  it("puts a queued chain's place into a badge and a waiting chain's reason into the tip", () => {
    const queued = html(createElement(StatusChip, { status: { kind: 'queued', position: 2 } }))
    expect(queued).not.toContain('·')
    expect(queued).toContain(`${t.chainStatus.queued}<span class="count-badge">2</span>`)
    const wait = { kind: 'slot' } as ChainWait
    const waiting = html(createElement(StatusChip, { status: { kind: 'running', limitUntil: null }, wait }))
    expect(waiting).not.toContain('·')
    expect(waiting).toContain(t.chainStatus.waiting)
    expect(waiting).not.toContain(`>${t.chainStatus.waitFor.slot}<`)
  })

  it("gives the work chip's number a badge, the words in the tip", () => {
    const work = { path: 'D:/repo/.claude/worktrees/abc-1', branch: 'abc-1/task', files: 0, ahead: 3 }
    const markup = html(createElement(WorkChip, { work }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(`${t.chain.work.unmerged}<span class="count-badge">3</span>`)
  })

  it('shows the context as the percent and the tokens in two cells', () => {
    const markup = html(createElement(ContextMeter, { tokens: 61_000, window: 250_000, scale: { warn: 60, danger: 80 } }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('<span class="context-meter__value">24%</span>')
    expect(markup).toContain('<span class="context-meter__value">61k / 250k</span>')
  })
})
