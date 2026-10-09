import { describe, expect, it } from 'vitest'
import { mapCalibration, stepOf, type CalibrationRow } from './calibration.js'

const row = (task: string, estimateH: number | null, activeMin: number, component: string | null = 'Core'): CalibrationRow => ({
  task,
  title: `Title of ${task}`,
  component,
  estimateH,
  activeMin,
})

describe('stepOf', () => {
  it('maps the hours Huly stores back to a step of the scale', () => {
    expect([0.08, 0.17, 0.33, 0.67, 1.33].map(stepOf)).toEqual([5, 10, 20, 40, 80])
  })

  it('leaves estimates of the old scale and no estimate outside the steps', () => {
    expect([0.25, 0.5, 1, 2, 0, null].map(stepOf)).toEqual([null, null, null, null, null, null])
  })
})

describe('mapCalibration', () => {
  it('gives each step its closed tasks, median and quartiles of the actual minutes', () => {
    const rows = [row('ABC-1', 0.33, 10), row('ABC-2', 0.33, 20), row('ABC-3', 0.33, 30), row('ABC-4', 0.33, 40), row('ABC-5', 0.33, 50)]
    const result = mapCalibration('ABC', null, rows, 5)
    expect(result.steps.find((step) => step.minutes === 20)).toEqual({ minutes: 20, closed: 5, median: 30, low: 20, high: 40, thin: false })
    expect(result.steps.find((step) => step.minutes === 5)).toEqual({ minutes: 5, closed: 0, median: null, low: null, high: null, thin: true })
    expect(result).toMatchObject({ project: 'ABC', closed: 5, estimated: 5, thin: false })
  })

  it('interpolates quartiles between tasks like percentile_cont', () => {
    const result = mapCalibration('ABC', null, [row('ABC-1', 0.08, 2), row('ABC-2', 0.08, 4)], 5)
    expect(result.steps[0]).toEqual({ minutes: 5, closed: 2, median: 3, low: 2.5, high: 3.5, thin: true })
  })

  it('marks the project thin when fewer closed tasks sit on the steps than the threshold', () => {
    const result = mapCalibration('ABC', null, [row('ABC-1', 0.33, 10), row('ABC-2', 1, 10), row('ABC-3', null, 10)], 2)
    expect(result).toMatchObject({ closed: 3, estimated: 1, thin: true })
  })

  it('lists recent tasks of the component of the task, newest first as the rows come', () => {
    const rows = [row('ABC-9', 0.17, 12, 'Web'), row('ABC-8', 1, 70, 'Core'), row('ABC-7', null, 5, 'Web')]
    const result = mapCalibration('ABC', 'Web', rows, 5)
    expect(result.scope).toBe('component')
    expect(result.recent).toEqual([
      { task: 'ABC-9', title: 'Title of ABC-9', component: 'Web', estimateMin: 10, activeMin: 12 },
      { task: 'ABC-7', title: 'Title of ABC-7', component: 'Web', estimateMin: null, activeMin: 5 },
    ])
  })

  it('falls back to the whole project without a component or without closed tasks in it', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(`ABC-${20 - index}`, 0.33, 15))
    expect(mapCalibration('ABC', null, rows, 5)).toMatchObject({ scope: 'project' })
    const other = mapCalibration('ABC', 'Docs', rows, 5)
    expect(other.scope).toBe('project')
    expect(other.recent.map((each) => each.task)).toEqual(['ABC-20', 'ABC-19', 'ABC-18', 'ABC-17', 'ABC-16', 'ABC-15', 'ABC-14', 'ABC-13'])
  })
})
