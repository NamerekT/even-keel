import { describe, expect, it } from 'vitest'
import { createFakeSource } from './live/fake.js'
import { readerTemplateLabels, templateLabels } from './templateHits.js'

const fresh = () => createFakeSource('').snapshot().state!

describe('labels an issue template puts on (BTN-1130)', () => {
  it('names the sources, then the intake, one entry a label with its templates', () => {
    const state = fresh()
    const github = state.trackers.find((tracker) => tracker.projects.includes('feed-abc-gh'))!
    github.templateHits = {
      'feed-abc-gh': [
        { label: 'bug', template: '.github/ISSUE_TEMPLATE/bug.yml' },
        { label: 'bug', template: '.github/ISSUE_TEMPLATE/crash.md' },
        { label: 'idea', template: '.github/ISSUE_TEMPLATE/idea.yml' },
      ],
    }
    state.intakeTemplates = { ABC: [{ label: 'accepted', template: '.github/ISSUE_TEMPLATE/bug.yml' }] }
    expect(templateLabels(state, 'ABC')).toEqual([
      { reader: 'feed-abc-gh', place: 'octo-org/storefront-ideas', feed: true, label: 'bug', templates: ['bug.yml', 'crash.md'] },
      { reader: 'feed-abc-gh', place: 'octo-org/storefront-ideas', feed: true, label: 'idea', templates: ['idea.yml'] },
      { reader: null, place: null, feed: false, label: 'accepted', templates: ['bug.yml'] },
    ])
    expect(readerTemplateLabels(state, 'feed-abc-lin')).toEqual([])
  })

  it('says nothing of a project without such labels, or of a reader the tracker no longer reads', () => {
    const state = fresh()
    const github = state.trackers.find((tracker) => tracker.projects.includes('feed-abc-gh'))!
    github.templateHits = { XYZ: [{ label: 'bug', template: '.github/ISSUE_TEMPLATE/bug.yml' }] }
    expect(templateLabels(state, 'ABC')).toEqual([])
    expect(templateLabels(state, 'XYZ')).toEqual([])
  })
})
