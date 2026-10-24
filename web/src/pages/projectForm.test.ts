import { describe, expect, it } from 'vitest'
import { fakeConfig } from '../live/fakeConfig.js'
import { formOf, masksOf, rowsText, standardRows, valuesOf } from './projectForm.js'

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
