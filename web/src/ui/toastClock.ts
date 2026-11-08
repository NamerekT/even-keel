/** What a timed toast's bar shows: whether it runs, and which run it is (a new round starts the bar over, full). */
export interface ToastClockView {
  running: boolean
  round: number
}

export type ToastHold = 'pointer' | 'focus'

/**
 * The timer of a toast that goes by itself (BTN-845). It counts only while the tab is in sight and nothing holds it:
 * a pointer over the toast or the focus inside stops it, and it goes on from the same place; a hidden tab drops the
 * count, and showing it starts the whole time over. After the timeout or `stop` it does nothing more.
 */
export class ToastClock {
  private left: number
  private since = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly holds = new Set<ToastHold>()
  private shown: ToastClockView = { running: false, round: 0 }
  private done = false

  constructor(
    private readonly ms: number,
    private readonly onTimeout: () => void,
    private hidden: boolean,
    private readonly onChange: (view: ToastClockView) => void = () => {},
  ) {
    this.left = ms
    this.settle(false)
  }

  view(): ToastClockView {
    return this.shown
  }

  hide(hidden: boolean): void {
    if (this.done || hidden === this.hidden) return
    this.hidden = hidden
    if (hidden) return this.settle(true)
    this.left = this.ms
    this.settle(true, this.shown.round + 1)
  }

  hold(reason: ToastHold, held: boolean): void {
    if (this.done) return
    if (held) this.holds.add(reason)
    else this.holds.delete(reason)
    this.settle(true)
  }

  stop(): void {
    if (this.done) return
    this.pause()
    this.done = true
    this.show({ running: false, round: this.shown.round }, true)
  }

  private settle(tell: boolean, round = this.shown.round): void {
    const running = !this.hidden && this.holds.size === 0
    if (running && this.timer === undefined) {
      this.since = Date.now()
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.done = true
        this.show({ running: false, round: this.shown.round }, true)
        this.onTimeout()
      }, this.left)
    } else if (!running) this.pause()
    this.show({ running, round }, tell)
  }

  private pause(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.left = Math.max(0, this.left - (Date.now() - this.since))
  }

  private show(view: ToastClockView, tell: boolean): void {
    if (view.running === this.shown.running && view.round === this.shown.round) return
    this.shown = view
    if (tell) this.onChange(view)
  }
}
