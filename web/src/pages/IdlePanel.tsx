import { type RefObject, useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { setLimitsGone, useHeaderFiveHour } from '../layout/limitsFix.js'
import { useVisible } from '../layout/useVisible.js'
import { stillMotion } from '../ui/landing.js'
import {
  actEnd,
  type Chat,
  chatAt,
  type ChatLine,
  chatStartsOf,
  chatTime,
  limitsFixReset,
  limitsGone,
  longestRun,
  type Meme,
  type Motion,
  momentsOf,
  pickMeme,
  playMotion,
  type Scene,
  selectionAt,
} from '../ui/memes.js'
import { TypedLine } from '../ui/Typed.js'
import { shownAt, typedAt, typingTime } from '../ui/typing.js'
import { VOYAGE_TICK_MS, VOYAGE_WIDTH, voyageFrame } from '../ui/voyage.js'

const IDLE_PACE = { charMs: 40, pauseMs: 1500 }
/** How long a line stays typed before it is erased for the next one: a general line always, the others at least. */
const HOLD_MS = 7000
const FORWARD: Motion = { sea: 1, cloud: 1 }

/**
 * Holds the side column while no panel is open, so the chain keeps its width. Its limits chat takes the header's limits
 * away for a while; they come back as it says so or as the panel is unmounted (a side panel, below 1200 px, another page).
 */
export function IdlePanel({ project, scene }: { project: string; scene: Scene }) {
  const moments = momentsOf(scene)
  const cue = moments.join()
  const five = useHeaderFiveHour(project)
  // Shown whole at once with reduced motion, the chat would have nothing to take away.
  const limitsReset = stillMotion() ? null : limitsFixReset(five, new Date())
  const draw = (previous?: Meme) => pickMeme(moments, t.project.idle.memes.length, Math.random, previous, { limitsReset })
  const [meme, setMeme] = useState<Meme>(() => draw())
  const parts = memeParts(meme, scene)
  const chat = 'chat' in meme ? chatLines(meme.chat, meme.reset) : null
  const starts = chat !== null && 'chat' in meme ? chatStartsOf(meme.chat, chat, IDLE_PACE) : []
  const play = 'play' in meme ? t.project.idle.plays[meme.play] : null
  const [shown, setShown] = useState(() => (stillMotion() ? Infinity : 0))
  const [said, setSaid] = useState<ReturnType<typeof chatAt>>({ said: [], selected: 0 })
  const [tick, setTick] = useState({ sea: 0, cloud: 0 })
  const motion = useRef(FORWARD)
  const visible = useVisible()
  const room = useRef<HTMLElement>(null)
  const picture = useRef<HTMLPreElement>(null)
  const columns = useColumns(room, picture)
  // When the line started, when it starts being erased (ms after the start), and the moments it was drawn on.
  const line = useRef({ start: performance.now(), eraseAt: null as number | null, cue })
  const latest = useRef({ meme, parts, chat, starts, cue, draw })
  latest.current = { meme, parts, chat, starts, cue, draw }

  // A general line, a moment's line and a chat go on their own; the drive stays until the moments change, and so does a
  // moment's line with reduced motion. A play piles up act by act; the picture keeps the pile for good.
  useEffect(() => {
    if ('line' in meme || 'play' in meme || 'chat' in meme || line.current.cue === cue) return
    if (stillMotion()) {
      line.current = { start: performance.now(), eraseAt: null, cue }
      setMeme(draw(meme))
      return
    }
    // The moments change as the page loads too, so a line drawn before that still gets its hold.
    line.current.eraseAt ??= Math.max(performance.now() - line.current.start, typingTime(parts, IDLE_PACE) + HOLD_MS)
  }, [cue])

  useEffect(() => {
    if (stillMotion()) return
    let frame = requestAnimationFrame(function step(now) {
      const { meme, parts, chat, starts, cue, draw } = latest.current
      const elapsed = now - line.current.start
      setLimitsGone('chat' in meme && meme.chat === 'limits' && limitsGone(starts, elapsed))
      const next = (meme: Meme) => {
        line.current = { start: now, eraseAt: null, cue }
        setMeme(meme)
      }
      let lines: ReturnType<typeof chatAt>
      if ('play' in meme) {
        const acts = t.project.idle.plays[meme.play].length
        const last = meme.act === acts - 1
        motion.current = playMotion(meme.play, meme.act, acts, elapsed, parts, IDLE_PACE)
        const end = last && meme.play === 'picture' ? null : actEnd(parts, IDLE_PACE, { last, holdMs: HOLD_MS })
        const selected = last ? selectionAt(acts, elapsed, end) : 0
        const count = typedAt(parts, elapsed, IDLE_PACE)
        const said = Array.from({ length: acts }, (_, act) => (selected === null || act > meme.act ? -1 : act < meme.act ? Infinity : count))
        lines = { said, selected: selected ?? 0 }
        if (!last && elapsed > end!) next({ play: meme.play, act: meme.act + 1 })
        else if (selected === null) next(draw(meme))
      } else {
        const held = (chat ? chatTime(chat, IDLE_PACE, starts) : typingTime(parts, IDLE_PACE)) + HOLD_MS
        const eraseAt = 'line' in meme || 'moment' in meme || chat ? held : line.current.eraseAt
        motion.current = FORWARD
        const count = shownAt(parts, elapsed, IDLE_PACE, eraseAt)
        lines = chat ? chatAt(chat, elapsed, IDLE_PACE, eraseAt, starts) : { said: [], selected: 0 }
        const gone = chat ? lines.said.every((shown) => shown < 0) : count === 0
        if (eraseAt !== null && elapsed > eraseAt && gone) next(draw(meme))
        setShown(count)
      }
      setSaid((current) => (current.said.join() === lines.said.join() && current.selected === lines.selected ? current : lines))
      frame = requestAnimationFrame(step)
    })
    return () => {
      cancelAnimationFrame(frame)
      setLimitsGone(false)
    }
  }, [])

  useEffect(() => {
    if (stillMotion() || !visible) return
    const timer = setInterval(() => {
      const { sea, cloud } = motion.current
      if (sea !== 0 || cloud !== 0) setTick((current) => ({ sea: current.sea + sea, cloud: current.cloud + cloud }))
    }, VOYAGE_TICK_MS)
    return () => clearInterval(timer)
  }, [visible])

  return (
    <aside className="idle" ref={room}>
      <div className="idle__scene">
        <pre className="idle__voyage" aria-hidden="true" ref={picture}>
          {voyageFrame(tick.sea, 'drive' in meme, tick.cloud, columns)}
        </pre>
        {chat ? (
          <ChatLines chat={chat} said={stillMotion() ? chatAt(chat, Infinity, IDLE_PACE, null) : said} />
        ) : play ? (
          <PlayActs acts={play} said={stillMotion() ? { said: play.map(() => Infinity), selected: 0 } : said} />
        ) : (
          <TypedLine text={parts.join('')} shown={shown} className="idle__meme" />
        )}
      </div>
    </aside>
  )
}

/** How many columns of the picture fit across the panel; measured on every resize, before the frame is painted. */
function useColumns(room: RefObject<HTMLElement | null>, picture: RefObject<HTMLPreElement | null>): number {
  const [columns, setColumns] = useState(VOYAGE_WIDTH.start)
  useEffect(() => {
    const panel = room.current
    const pre = picture.current
    const context = document.createElement('canvas').getContext('2d')
    if (!panel || !pre || !context) return
    const observer = new ResizeObserver(() => {
      context.font = getComputedStyle(pre).font
      const char = context.measureText('M'.repeat(100)).width / 100
      const style = getComputedStyle(panel)
      const inner = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (char > 0) setColumns(Math.max(VOYAGE_WIDTH.min, Math.floor(inner / char)))
    })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])
  return columns
}

/** Every line is laid out from the start, so the panel keeps its height while they come; `said` as from `chatAt`. */
function ChatLines({ chat, said: { said, selected } }: { chat: ChatLine[]; said: ReturnType<typeof chatAt> }) {
  return (
    <div className="idle__chat">
      {chat.map((line, index) => {
        const count = said[index] ?? -1
        const className = `idle__said${'human' in line ? ' idle__said--human' : ''}${index >= chat.length - selected ? ' idle__said--selected' : ''}`
        return 'human' in line ? (
          <TypedLine key={index} text={`> ${line.human}`} shown={count < 0 ? -1 : Infinity} className={className} />
        ) : (
          <TypedLine key={index} text={`● ${line.agent}`} shown={count < 0 ? -1 : count + 2} className={className} />
        )
      })}
    </div>
  )
}

/** A play's acts, laid out from the start like a chat's lines; the acts before the newest typed one are muted. */
function PlayActs({ acts, said: { said, selected } }: { acts: readonly string[][]; said: ReturnType<typeof chatAt> }) {
  return (
    <div className="idle__chat">
      {acts.map((parts, index) => {
        const past = (said[index + 1] ?? -1) >= 0
        const className = `idle__meme${past ? ' idle__meme--past' : ''}${index >= acts.length - selected ? ' idle__said--selected' : ''}`
        return <TypedLine key={index} text={parts.join('')} shown={said[index] ?? -1} className={className} />
      })}
    </div>
  )
}

/** A chat's lines; the limits chat names its reset in the last one. */
function chatLines(chat: Chat, reset = ''): ChatLine[] {
  const lines = t.project.idle.chats[chat]
  return typeof lines === 'function' ? lines(reset) : lines
}

function memeParts(meme: Meme, scene: Scene): string[] {
  const { idle } = t.project
  if ('chat' in meme) return []
  if ('drive' in meme) return idle.drive
  if ('line' in meme) return idle.memes[meme.line]!
  if ('play' in meme) return idle.plays[meme.play][meme.act]!
  const line = idle.moments[meme.moment]
  return typeof line === 'function' ? line(longestRun(scene.blocks)) : line
}
