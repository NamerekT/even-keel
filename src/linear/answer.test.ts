import { describe, expect, it } from 'vitest'
import { graphqlBody } from './answer.js'

/** A body that gives `start` and then breaks off as undici does when the socket closes mid-body. */
function brokenOff(start: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(start))
      controller.error(new TypeError('terminated', { cause: new Error('other side closed') }))
    },
  })
  return new Response(stream, { status })
}

describe('graphqlBody', () => {
  it('reads the JSON of the answer', async () => {
    expect(await graphqlBody(new Response(JSON.stringify({ data: { a: 1 } })))).toEqual({ data: { a: 1 } })
  })

  it('names a body that broke off, with its cause (BTN-1467)', async () => {
    await expect(graphqlBody(brokenOff('{"data":{"issue'))).rejects.toThrow('linear: the answer broke off: terminated: other side closed')
  })

  it('names a body that is no JSON', async () => {
    await expect(graphqlBody(new Response('{"data":{"issue', { status: 200 }))).rejects.toThrow(/^linear: the answer is no JSON: /)
  })

  it('reads an empty body as nothing, left to the caller to call an empty answer', async () => {
    expect(await graphqlBody(new Response(null, { status: 200 }))).toEqual({})
  })

  it('leaves a failed status to name the failure when its body is unreadable', async () => {
    expect(await graphqlBody(brokenOff('<html', 502))).toEqual({})
    expect(await graphqlBody(new Response('<html>Bad gateway</html>', { status: 502 }))).toEqual({})
  })
})
