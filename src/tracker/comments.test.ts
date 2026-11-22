import { describe, expect, it } from 'vitest'
import { commentsAfterId, linkedFiles } from './comments.js'

const comment = (id: string) => ({ id, body: id, files: [] })

describe('commentsAfterId', () => {
  it('gives the comments after the given one', () => {
    expect(commentsAfterId([comment('a'), comment('b'), comment('c')], 'a').map((each) => each.id)).toEqual(['b', 'c'])
    expect(commentsAfterId([comment('a')], 'gone')).toEqual([])
  })
})

describe('linkedFiles', () => {
  const host = /^https:\/\/uploads\.example\.com\//

  it('takes links to the upload host once, named by the link text', () => {
    const body = [
      '2',
      '![shot.png](https://uploads.example.com/a/b/shot-id)',
      '[logs.zip](https://uploads.example.com/c/logs.zip) and https://uploads.example.com/c/logs.zip again',
      '<img src="https://uploads.example.com/d/raw%20name.png">',
      'https://elsewhere.example.com/x.png',
    ].join('\n')
    expect(linkedFiles(body, host)).toEqual([
      { name: 'shot.png', file: 'https://uploads.example.com/a/b/shot-id' },
      { name: 'logs.zip', file: 'https://uploads.example.com/c/logs.zip' },
      { name: 'raw name.png', file: 'https://uploads.example.com/d/raw%20name.png' },
    ])
  })

  it("names an HTML picture by its alt, whatever the attributes' order", () => {
    const body = [
      '<img width="640" height="480" alt="Board &amp; cards" src="https://uploads.example.com/e/id-1" />',
      "<img src='https://uploads.example.com/e/id-2' alt='second'>",
      '<img alt="" src="https://uploads.example.com/e/id-3">',
    ].join('\n')
    expect(linkedFiles(body, host)).toEqual([
      { name: 'Board & cards', file: 'https://uploads.example.com/e/id-1' },
      { name: 'second', file: 'https://uploads.example.com/e/id-2' },
      { name: 'id-3', file: 'https://uploads.example.com/e/id-3' },
    ])
  })
})
