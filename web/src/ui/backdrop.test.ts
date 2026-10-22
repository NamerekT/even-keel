import { describe, expect, it, vi } from 'vitest'
import { backdropHandlers, type BackdropEvent } from './backdrop.js'

const backdrop = { name: 'backdrop' } as unknown as EventTarget
const window = { name: 'window' } as unknown as EventTarget

const event = (target: EventTarget, button = 0): BackdropEvent & { prevented: boolean } => {
  const fired = {
    target,
    button,
    prevented: false,
    preventDefault: () => {
      fired.prevented = true
    },
  }
  return fired
}

const setup = () => {
  const close = vi.fn()
  const handlers = backdropHandlers({ current: false }, (target) => target === backdrop, close)
  const press = (down: EventTarget, up: EventTarget, button = 0) => {
    handlers.onPointerDown(event(down, button))
    handlers.onPointerUp(event(up, button))
  }
  return { close, handlers, press }
}

describe('backdropHandlers', () => {
  it('closes when the left button goes down and up on the backdrop', () => {
    const { close, press } = setup()
    press(backdrop, backdrop)
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps the window when the press starts inside it and ends on the backdrop', () => {
    const { close, press } = setup()
    press(window, backdrop)
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps the window when the press starts on the backdrop and ends inside it', () => {
    const { close, press } = setup()
    press(backdrop, window)
    expect(close).not.toHaveBeenCalled()
  })

  it('ignores buttons other than the left one', () => {
    const { close, press } = setup()
    press(backdrop, backdrop, 2)
    expect(close).not.toHaveBeenCalled()
  })

  it('forgets a press from the window once it is released', () => {
    const { close, handlers, press } = setup()
    press(backdrop, window)
    handlers.onPointerUp(event(backdrop))
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps a press on the backdrop from starting a text selection', () => {
    const { handlers } = setup()
    const onBackdrop = event(backdrop)
    const inside = event(window)
    handlers.onMouseDown(onBackdrop)
    handlers.onMouseDown(inside)
    expect(onBackdrop.prevented).toBe(true)
    expect(inside.prevented).toBe(false)
  })
})
