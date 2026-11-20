// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalPictures, type LocalPictures } from './localPictures.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const create = vi.fn((file: File) => `blob:${file.name}`)
const revoke = vi.fn()
let root: Root
let pictures: LocalPictures

function Probe({ sessionId }: { sessionId: string }) {
  pictures = useLocalPictures(sessionId)
  return null
}

const show = (sessionId: string) => act(async () => root.render(createElement(Probe, { sessionId })))

beforeEach(async () => {
  URL.createObjectURL = create
  URL.revokeObjectURL = revoke
  create.mockClear()
  revoke.mockClear()
  root = createRoot(document.createElement('div'))
})

afterEach(async () => {
  await act(async () => root.unmount())
})

describe('the pictures a chat window sent', () => {
  // BTN-1387: a new project chat has no session until it starts, which may take minutes after the message went out.
  it('outlive the start of a new chat’s first session', async () => {
    await show('')
    act(() => void pictures.add([new File(['x'], 'shot.png')]))
    await show('6bc306d9')
    expect(pictures.get('shot.png')).toBe('blob:shot.png')
    expect(revoke).not.toHaveBeenCalled()
  })

  it('are let go when the window turns to another session', async () => {
    await show('6bc306d9')
    act(() => void pictures.add([new File(['x'], 'shot.png')]))
    await show('7de417e0')
    expect(pictures.get('shot.png')).toBeUndefined()
    expect(revoke).toHaveBeenCalledWith('blob:shot.png')
  })

  it('are let go when the window closes', async () => {
    await show('')
    act(() => void pictures.add([new File(['x'], 'shot.png')]))
    await act(async () => root.unmount())
    expect(revoke).toHaveBeenCalledWith('blob:shot.png')
    root = createRoot(document.createElement('div'))
  })
})
