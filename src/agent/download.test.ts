import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadFile } from './download.js'

afterEach(() => vi.unstubAllGlobals())

describe('download byte progress', () => {
  it.each([undefined, 12])('uses the response size or the manifest size (%s) and reports the final byte', async (size) => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-progress-'))
    try {
      const bytes = new Uint8Array([1, 2, 3, 4])
      vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-length': '4' } })))
      const progress = vi.fn()
      const result = await downloadFile('https://example.com/cli', join(dir, 'cli'), 'sha256', progress, size)
      expect(result.bytes).toBe(4)
      expect(progress).toHaveBeenNthCalledWith(1, 0, size ?? 4)
      expect(progress).toHaveBeenLastCalledWith(4, size ?? 4)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports the final byte when the server does not send Content-Length', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-progress-'))
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          await new Promise((resolve) => setTimeout(resolve, 10))
          controller.enqueue(new Uint8Array([3, 4]))
          controller.close()
        },
      }))))
      const progress = vi.fn()
      await downloadFile('https://example.com/cli', join(dir, 'cli'), 'sha256', progress)
      expect(progress).toHaveBeenLastCalledWith(4, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
