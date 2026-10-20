import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { fieldOf } from './settingsField.js'

const keys = ['github', 'linear']

describe('fieldOf', () => {
  it('points an error of a project at its field', () => {
    expect(fieldOf(notice('config.branch', { where: 'ABC.branch', value: '"a b"' }), keys)).toEqual({ project: 'ABC', field: 'branch' })
    expect(fieldOf(notice('config.repoEmpty', { key: 'ABC' }), keys)).toEqual({ project: 'ABC', field: 'repo' })
    expect(fieldOf(notice('config.slot', { key: 'ABC' }), keys)).toEqual({ project: 'ABC', field: 'slot' })
    expect(fieldOf(notice('config.trackerProject', { where: 'ABC.github', example: 'octo-org/example' }), keys)).toEqual({ project: 'ABC', field: 'trackerProject' })
    expect(fieldOf(notice('config.trackerUnknown', { where: 'ABC.tracker', name: 'jira', known: [] }), keys)).toEqual({ project: 'ABC', field: 'tracker' })
    expect(fieldOf(notice('config.ruleList', { where: 'ABC.chain', key: 'requiredLabels' }), keys)).toEqual({ project: 'ABC', field: 'chain.requiredLabels' })
    expect(fieldOf(notice('config.statusBoth', { project: 'ABC', status: 'Done' }), keys)).toEqual({ project: 'ABC', field: 'chain.terminal' })
    expect(fieldOf(notice('config.commandList', { where: 'ABC.commands.check' }), keys)).toEqual({ project: 'ABC', field: 'check' })
    expect(fieldOf(notice('config.ciWait', { where: 'ABC.ci.waitMinutes' }), keys)).toEqual({ project: 'ABC', field: 'ci' })
    expect(fieldOf(notice('config.brief', { where: 'ABC.fillMilestone' }), keys)).toEqual({ project: 'ABC', field: 'fillMilestone' })
  })

  it('points a shared error at the field of the settings page', () => {
    expect(fieldOf(notice('config.parallel', { value: '0' }), keys)).toEqual({ project: null, field: 'parallel' })
    expect(fieldOf(notice('config.brief', { where: 'brief' }), keys)).toEqual({ project: null, field: 'brief' })
    expect(fieldOf(notice('config.ruleKey', { where: 'chain', key: 'odd' }), keys)).toEqual({ project: null, field: 'chain.active' })
    expect(fieldOf(notice('config.language', { where: 'promptLanguage', value: '"de"', known: [] }), keys)).toEqual({ project: null, field: 'promptLanguage' })
    expect(fieldOf(notice('config.modelPromptEmpty', { model: 'haiku' }), keys)).toEqual({ project: null, field: 'modelPrompts' })
    expect(fieldOf(notice('config.notObject', { where: 'stats.compare' }), keys)).toEqual({ project: null, field: 'stats' })
    expect(fieldOf(notice('config.contextPercents', {}), keys)).toEqual({ project: null, field: 'context' })
  })

  it('points a checkpoint share error at the shares of its level', () => {
    expect(fieldOf(notice('config.checkpointShare', { where: 'stats.checkpointShares.late', value: '0' }), keys)).toEqual({ project: null, field: 'checkpointShares' })
    const order = { where: 'ABC.stats.checkpointShares', first: 90, late: 85, hard: 95 }
    expect(fieldOf(notice('config.checkpointShareOrder', order), keys)).toEqual({ project: 'ABC', field: 'checkpointShares' })
  })

  it('leaves the errors no field shows to the banner', () => {
    expect(fieldOf(notice('config.notJson', { file: 'even-keel.config.json' }), keys)).toBeNull()
    expect(fieldOf(notice('config.projectKey', { where: 'projects[0].key', value: '"abc"' }), keys)).toBeNull()
  })
})
