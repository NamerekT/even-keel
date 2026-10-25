import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codex } from './adapter.js'
import { RolloutFold } from './rollout.js'

const SESSION = '00000000-0000-4000-8000-000000000001'
const AT = '2026-10-25T12:00:00.000Z'
const PATH = 'C:/repos/example/.temp/screen.png'
const picture = (data = 'Zmlyc3Q=', type = 'image/png') => ({ type: 'input_image', image_url: `data:${type};base64,${data}` })
const response = (payload: Record<string, unknown>) => JSON.stringify({ timestamp: AT, type: 'response_item', payload })
const call = (input: string, callId = 'call-1') => response({ type: 'custom_tool_call', name: 'exec', call_id: callId, input })
const output = (images: unknown[], callId = 'call-1', type = 'custom_tool_call_output') => response({ type, call_id: callId, output: images })
const imageLines = (lines: string[], whole = true) => {
  const fold = new RolloutFold(Infinity, whole)
  for (const line of lines) fold.push(line)
  return fold.summary().feed
}
let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('Codex rollout pictures', () => {
  it.each([1, 2])('adds one image line for a code-mode result holding %s pictures', (count) => {
    const lines = [call(`image((await tools.view_image({path:${JSON.stringify(PATH)}})).image_url)`), output(Array.from({ length: count }, () => picture()))]
    expect(imageLines(lines)).toEqual([{ at: AT, kind: 'image', text: PATH, tool: 'call-1', images: count }])
    expect(imageLines(lines, false)).toEqual([])
    expect(JSON.stringify(imageLines(lines))).not.toContain('base64')
  })

  it('reads ordinary function results and their view_image arguments', () => {
    expect(imageLines([
      response({ type: 'function_call', name: 'view_image', call_id: 'direct', arguments: JSON.stringify({ path: PATH }) }),
      output([{ type: 'input_text', text: 'Image follows' }, picture()], 'direct', 'function_call_output'),
    ])).toEqual([{ at: AT, kind: 'image', text: PATH, tool: 'direct', images: 1 }])
  })

  it('keeps a result without a known path, including a wrapper with computed paths', () => {
    expect(imageLines([
      call('for (const path of paths) image((await tools.view_image({path})).image_url)'),
      output([picture(), picture()]),
      output([picture()], 'unknown'),
    ]).map(({ text, tool, images }) => ({ text, tool, images }))).toEqual([
      { text: '', tool: 'call-1', images: 2 }, { text: '', tool: 'unknown', images: 1 },
    ])
  })

  it.each(["'C:/repos/example/.temp/screen.png'", '`C:/repos/example/.temp/screen.png`', JSON.stringify(PATH)])('reads a static code-mode path written as %s', (literal) => {
    expect(imageLines([call(`image((await tools.view_image({ path: ${literal} })).image_url)`), output([picture()])])[0]?.text).toBe(PATH)
  })

  it('does not guess a shared filename for several different view_image calls', () => {
    const code = 'image((await tools.view_image({path:"one.png"})).image_url); image((await tools.view_image({path:"two.png"})).image_url)'
    expect(imageLines([call(code), output([picture(), picture()])])[0]?.text).toBe('')
  })

  it('decodes Windows paths and leaves malformed or interpolated arguments unnamed', () => {
    const path = 'C:\\repos\\example\\.temp\\screen.png'
    expect(imageLines([call(`image(await tools.view_image({path:${JSON.stringify(path)}}))`), output([picture()])])[0]?.text).toBe(path)
    expect(imageLines([call('image(await tools.view_image({path:`C:/shots/${file}`}))'), output([picture()])])[0]?.text).toBe('')
    expect(imageLines([
      response({ type: 'function_call', name: 'view_image', call_id: 'broken', arguments: '{broken' }),
      output([picture()], 'broken', 'function_call_output'),
    ])[0]?.text).toBe('')
  })

  it('appends completed pictures without changing earlier lines, in completion order', () => {
    const fold = new RolloutFold(Infinity, true)
    fold.push(call('image(await tools.view_image({path:"one.png"}))', 'one'))
    fold.push(call('image(await tools.view_image({path:"two.png"}))', 'two'))
    expect(fold.summary().feed).toEqual([])
    fold.push(output([picture()], 'two'))
    const first = fold.summary().feed
    fold.push(output([picture(), picture()], 'one'))
    expect(fold.summary().feed).toEqual([...first, { at: AT, kind: 'image', text: 'one.png', tool: 'one', images: 2 }])
    expect(first).toEqual([{ at: AT, kind: 'image', text: 'two.png', tool: 'two', images: 1 }])
  })

  it('ignores text, user attachments, external URLs and malformed results', () => {
    expect(imageLines([
      response({ type: 'message', role: 'user', content: [picture()] }),
      response({ type: 'custom_tool_call_output', output: [picture()] }),
      output([null, {}, { type: 'input_image', image_url: 'https://example.com/image.png' }, { type: 'input_text', text: JSON.stringify(picture()) }]),
      output([{ type: 'input_image', image_url: 'data:image/png;base64,' }]),
      output([{ type: 'input_image', image_url: 'data:text/html;base64,Zmlyc3Q=' }]),
    ])).toEqual([])
  })

  it('serves each picture through the adapter by call id and index, from the rollout alone', async () => {
    await mkdir('.temp', { recursive: true })
    dir = await mkdtemp(join('.temp', 'codex-images-'))
    const sessions = join(dir, 'sessions', '2026', '10', '25')
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, `rollout-example-${SESSION}.jsonl`), [
      call('image(await tools.view_image({path:"deleted.png"}))'),
      output([{ type: 'input_text', text: 'not a picture' }, picture(), picture('c2Vjb25k', 'image/jpeg')]),
      output([picture('dGhpcmQ=')], 'direct', 'function_call_output'),
      '{incomplete',
    ].join('\n'))
    const agent = codex.setup({ env: () => ({}), timeoutMs: 1000, workDir: dir, checkedCli: () => false, log: () => {}, onCliChange: () => {} })
    const home = { key: 'example', dir, agent: 'codex' as const }
    expect(await agent.image?.(home, SESSION, 'call-1', 0)).toEqual({ type: 'image/png', data: 'Zmlyc3Q=' })
    expect(await agent.image?.(home, SESSION, 'call-1', 1)).toEqual({ type: 'image/jpeg', data: 'c2Vjb25k' })
    expect(await agent.image?.(home, SESSION, 'direct', 0)).toEqual({ type: 'image/png', data: 'dGhpcmQ=' })
    expect(await agent.image?.(home, SESSION, 'call-1', 2)).toBeUndefined()
    expect(await agent.image?.(home, SESSION, 'missing', 0)).toBeUndefined()
    expect(await agent.image?.(home, '00000000-0000-4000-8000-000000000002', 'call-1', 0)).toBeUndefined()
    expect((await agent.feed(home, SESSION, 1))?.lines).toEqual([{ at: AT, kind: 'image', text: '', tool: 'direct', images: 1 }])
  })
})
