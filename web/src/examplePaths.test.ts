import { describe, expect, it } from 'vitest'
import { examplePaths } from './examplePaths'

describe('examplePaths', () => {
  it('gives a Windows folder on win32', () => {
    expect(examplePaths('win32')).toEqual({ repo: 'D:/Projects/example', movedFrom: 'D:/old/abc', movedTo: 'D:/Projects/abc' })
  })

  it('gives a home folder on Linux', () => {
    expect(examplePaths('linux')).toEqual({ repo: '/home/john/projects/example', movedFrom: '/home/john/old/abc', movedTo: '/home/john/projects/abc' })
  })

  it('gives a home folder on macOS', () => {
    expect(examplePaths('darwin')).toEqual({ repo: '/Users/john/Projects/example', movedFrom: '/Users/john/old/abc', movedTo: '/Users/john/Projects/abc' })
  })

  it('takes Linux for any other platform', () => {
    expect(examplePaths('freebsd')).toEqual(examplePaths('linux'))
  })
})
