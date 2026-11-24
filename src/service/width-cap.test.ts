import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { checkWidth, fitWidths } from './width-cap.js'

describe("a project's width within its machines (BTN-1571)", () => {
  const fitted = (widths: Record<string, number>, caps: Record<string, number | undefined>) => {
    const saved: Array<[string, number]> = []
    const lines: string[] = []
    fitWidths(Object.keys(widths), {
      widthOf: (project) => widths[project]!,
      capOf: (project) => caps[project],
      save: (project, width) => void saved.push([project, width]),
      label: (project) => `"${project}"`,
      log: (line) => void lines.push(line),
    })
    return { saved, lines }
  }

  it('cuts a width above the machines left in the list and logs it', () => {
    expect(fitted({ abc: 2 }, { abc: 1 })).toEqual({
      saved: [['abc', 1]],
      lines: ['config: project "abc" runs 1 task(s) at once, not 2: it has 1 machine(s) now'],
    })
  })

  it('never raises a width: a machine connected leaves it as it was', () => {
    expect(fitted({ abc: 2, xyz: 1 }, { abc: 3, xyz: 2 })).toEqual({ saved: [], lines: [] })
  })

  it('leaves the widths alone while the machines are not read yet', () => {
    expect(fitted({ abc: 3 }, { abc: undefined })).toEqual({ saved: [], lines: [] })
  })

  it('goes on with the next project when a write fails', () => {
    const saved: string[] = []
    const lines: string[] = []
    fitWidths(['abc', 'xyz'], {
      widthOf: () => 3,
      capOf: () => 2,
      save: (project) => {
        if (project === 'abc') throw new Error('the config does not parse')
        saved.push(project)
      },
      label: (project) => project,
      log: (line) => void lines.push(line),
    })
    expect(saved).toEqual(['xyz'])
    expect(lines[0]).toBe('config: the width of project abc was not cut to 2: the config does not parse')
  })

  it("refuses a width the page saves above the project's machines, two of them one turned off holding 2", () => {
    expect(() => checkWidth(2, 1, 2)).not.toThrow()
    expect(noticeOf(catching(() => checkWidth(3, 1, 2)))).toMatchObject({ code: 'config.widthOverMachines', params: { max: 2 } })
    // A width saved before the machine went stays until the fit cuts it: a save of other fields is not refused for it.
    expect(() => checkWidth(3, 3, 2)).not.toThrow()
    expect(() => checkWidth(5, 1, undefined)).not.toThrow()
  })
})

function catching(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('nothing was thrown')
}
