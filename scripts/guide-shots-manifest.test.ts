import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { guideImageProblems, imageRefsOf, parseManifest } from './guide-shots-manifest.ts'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')

describe("the guide's screenshots", () => {
  it('every picture of the guide is a frame of the manifest, every frame is in the guide and has its file', () => {
    expect(guideImageProblems(root)).toEqual([])
  })

  it('reads a frame with its defaults filled in', () => {
    const [frame] = parseManifest(JSON.stringify({ frames: [{ id: 'chain', route: '/p/ABC', selector: '.chain' }] }))
    expect(frame).toEqual({
      id: 'chain', route: '/p/ABC', selector: '.chain', steps: [],
      width: 1280, height: 800, theme: 'dark', scale: 1, quality: 0.9, settle: 500,
    })
  })

  it("turns a frame's steps into the steps of npm run shot", () => {
    const [frame] = parseManifest(JSON.stringify({
      frames: [{ id: 'menu', route: '/', steps: [{ click: '.gear' }, { wait: '300' }, { drop: '' }] }],
    }))
    expect(frame!.steps).toEqual([{ kind: 'click', arg: '.gear' }, { kind: 'wait', arg: '300' }, { kind: 'drop', arg: '' }])
  })

  it.each([
    [{ id: 'Bad id', route: '/' }, 'id'],
    [{ id: 'a', route: 'p/ABC' }, 'route'],
    [{ id: 'a', route: '/', theme: 'blue' }, 'theme'],
    [{ id: 'a', route: '/', scale: 9 }, 'scale'],
    [{ id: 'a', route: '/', quality: 0 }, 'quality'],
    [{ id: 'a', route: '/', steps: [{ jump: '.x' }] }, 'step'],
    [{ id: 'a', route: '/', steps: [{ click: '.x', hover: '.y' }] }, 'step'],
    [{ id: 'a', route: '/', crop: { x: 0, y: 0, width: 0, height: 10 } }, 'crop'],
    [{ id: 'a', route: '/', colour: 'red' }, 'colour'],
  ])('refuses a wrong frame: %j', (frame, word) => {
    expect(() => parseManifest(JSON.stringify({ frames: [frame] }))).toThrow(word)
  })

  it('refuses two frames of one id', () => {
    expect(() => parseManifest(JSON.stringify({ frames: [{ id: 'a', route: '/' }, { id: 'a', route: '/' }] }))).toThrow('twice')
  })

  it('finds the pictures a page links, in markdown and in img tags, outside code', () => {
    const text = [
      '![The chain](images/chain.webp) and ![](./images/menu.webp "Menu")',
      '<img src="images/card.webp" width="400">',
      '`![not](images/code.webp)`',
      '```',
      '![not](images/fenced.webp)',
      '```',
      '[a page](setup.md)',
    ].join('\r\n')
    expect(imageRefsOf(text)).toEqual(['chain.webp', 'menu.webp', 'card.webp'])
  })

  it('names orphan frames, unknown pictures, missing files and stray files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guide-shots-'))
    try {
      const guide = join(dir, 'docs', 'guide')
      mkdirSync(join(guide, 'images'), { recursive: true })
      writeFileSync(join(guide, 'images', 'shots.json'), JSON.stringify({
        frames: [{ id: 'used', route: '/' }, { id: 'orphan', route: '/' }, { id: 'unshot', route: '/' }],
      }))
      writeFileSync(join(guide, 'images', 'used.webp'), 'x')
      writeFileSync(join(guide, 'images', 'orphan.webp'), 'x')
      writeFileSync(join(guide, 'images', 'stray.webp'), 'x')
      writeFileSync(join(guide, 'page.md'), '![](images/used.webp) ![](images/unshot.webp) ![](images/unknown.webp) ![](images/old.png)\n')
      expect(guideImageProblems(dir)).toEqual([
        'docs/guide/page.md links images/unknown.webp, which is no frame of docs/guide/images/shots.json',
        'docs/guide/page.md links images/old.png, which is no frame of docs/guide/images/shots.json',
        'the frame orphan is linked from no page of docs/guide',
        'the frame unshot has no docs/guide/images/unshot.webp: npm run guide-shots -- unshot',
        'docs/guide/images/stray.webp is no frame of docs/guide/images/shots.json',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
