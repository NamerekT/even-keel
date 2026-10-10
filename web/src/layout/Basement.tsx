import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n/index.js'
import './basement.css'

type Depth = 'far' | 'mid' | 'near'

interface Tape {
  depth: Depth
  /** Index of the word in `t.basement.tapes`; none — hazard stripes. */
  word?: number
  top: number
  tilt: number
  /** Torn at a share of the width; the left and right pieces hang by `droop` degrees. */
  tear?: { at: number; droop: [number, number] }
  worn?: boolean
}

const TAPES: Tape[] = [
  { depth: 'far', word: 0, top: 44, tilt: -2.2, worn: true },
  { depth: 'far', top: 74, tilt: 1.6, tear: { at: 0.7, droop: [3, 9] } },
  { depth: 'mid', word: 1, top: 104, tilt: -3, tear: { at: 0.43, droop: [5, 4] } },
  { depth: 'mid', top: 136, tilt: 2.3, worn: true },
  { depth: 'near', word: 2, top: 164, tilt: -1.3, worn: true },
  { depth: 'near', word: 3, top: 196, tilt: 2.6, tear: { at: 0.2, droop: [13, 2.5] } },
]

const GAP = 1.2

/** Where a page's basement goes: below `main`, so that it spans the whole window. */
export const BasementSlot = createContext<HTMLElement | null>(null)

interface SceneProps {
  sign: string[]
  /** The scene takes the rest of the window instead of a strip at the bottom. */
  tall?: boolean
  /** Nothing is being built here: the "work in progress" tape is bare stripes. */
  idle?: boolean
  /** Goes on the sign after its text. */
  children?: ReactNode
}

const WORK_IN_PROGRESS = 2

/** The bottom of a page that is still being built; it comes once the page is `ready` and stays. */
export function Basement({ ready, ...scene }: SceneProps & { ready: boolean }) {
  const slot = useContext(BasementSlot)
  const [shown, setShown] = useState(ready)
  if (ready && !shown) setShown(true)
  return shown && slot !== null ? createPortal(<Scene {...scene} />, slot) : null
}

/** A wall, a floor, caution tapes across the whole width and a sign. */
function Scene({ sign: [question, ...answer], tall, idle, children }: SceneProps) {
  return (
    <div className={tall ? 'basement basement--tall' : 'basement'}>
      <div className="basement__wall" />
      <div className="basement__floor" />
      <div className="basement__tapes" aria-hidden="true">
        {TAPES.map((tape, index) => (
          <TapeView key={index} tape={idle && tape.word === WORK_IN_PROGRESS ? { ...tape, word: undefined } : tape} />
        ))}
      </div>
      <p className="basement__sign">
        <strong>{question}</strong> {answer.join(' ')} {children}
        <span className="basement__legs" />
      </p>
    </div>
  )
}

function TapeView({ tape }: { tape: Tape }) {
  const style = { top: tape.top, '--tilt': `${tape.tilt}deg` } as CSSProperties
  if (tape.tear === undefined) {
    return (
      <div className={`basement__tape basement__tape--${tape.depth}`} style={style}>
        <Band tape={tape} />
      </div>
    )
  }
  const { at, droop } = tape.tear
  return (
    <div className={`basement__tape basement__tape--${tape.depth}`} style={style}>
      <span className="basement__piece basement__piece--left" style={{ width: `${at * 100 - GAP}%`, '--droop': `${droop[0]}deg` } as CSSProperties}>
        <span className="basement__sway">
          <Band tape={tape} torn="left" />
        </span>
      </span>
      <span className="basement__piece basement__piece--right" style={{ width: `${(1 - at) * 100 - GAP}%`, '--droop': `${-droop[1]}deg` } as CSSProperties}>
        <span className="basement__sway">
          <Band tape={tape} torn="right" />
        </span>
      </span>
    </div>
  )
}

function Band({ tape, torn }: { tape: Tape; torn?: 'left' | 'right' }) {
  const word = tape.word === undefined ? null : t.basement.tapes[tape.word]!
  const classes = ['basement__band', word === null && 'basement__band--hazard', tape.worn && 'basement__band--worn', torn && `basement__band--torn-${torn}`]
  return <span className={classes.filter(Boolean).join(' ')}>{word !== null && <span>{Array.from({ length: 18 }, () => word).join('  ·  ')}</span>}</span>
}
