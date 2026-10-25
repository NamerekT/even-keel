import { describe, expect, it } from 'vitest'
import type { ProjectForm } from '../../../src/state.js'
import { fakeConfig } from '../live/fakeConfig.js'
import { formOf, masksOf, rowsText, standardRows, valuesOf } from './projectForm.js'

it('keeps the GitLab CI selection and remote profile through the project settings draft', () => {
  const config = fakeConfig()
  const form: ProjectForm = { ...config.projects.ABC!, ci: { ...config.projects.ABC!.ci, kinds: ['gitlab'] }, remoteProfiles: { gitlab: 'lab-profile' }, own: { 'ci.kinds': ['gitlab'] } }
  const result = formOf(valuesOf(form, {}), form.name, config.shared)
  expect(result?.ci.kinds).toEqual(['gitlab'])
  expect(result?.remoteProfiles).toEqual({ gitlab: 'lab-profile' })
})

describe("the project form's standards", () => {
  it('go to the draft and back as they were', () => {
    const config = fakeConfig()
    const form = config.projects.ABC!
    expect(formOf(valuesOf(form, {}), form.name, config.shared)?.standards).toEqual(form.standards)
  })

  it('send the masks as typed, split at commas and line breaks, the empty ones dropped', () => {
    const values = { ...valuesOf(fakeConfig().projects.XYZ!, {}), standards: rowsText([{ doc: ' STYLE.md ', files: 'src/**/*.ts, ,\nweb/*.css,', except: '', shots: false }]) }
    expect(formOf(values, null, fakeConfig().shared)?.standards).toEqual([{ doc: 'STYLE.md', files: ['src/**/*.ts', 'web/*.css'], except: [], shots: false }])
    expect(masksOf(' a , b ')).toEqual(['a', 'b'])
    expect(standardRows(rowsText([]))).toEqual([])
  })
})
