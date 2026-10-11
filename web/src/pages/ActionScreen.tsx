import { useState } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { Typed } from '../ui/Typed.js'

const ACTION_PACE = { charMs: 12, pauseMs: 0 }

/** The current action of the lead block on a small screen: a new line types in while the previous one scrolls away. */
export function ActionScreen({ line }: { line: FeedLine }) {
  const key = `${line.at} ${line.text}`
  const [shown, setShown] = useState<{ key: string; line: FeedLine; previous: FeedLine | null }>({ key, line, previous: null })
  if (shown.key !== key) setShown({ key, line, previous: shown.line })

  return (
    <div className={`block__action screen screen--${line.kind}`} title={line.text}>
      {shown.previous !== null && (
        <p key={`out ${key}`} className="screen__line screen__line--out" aria-hidden="true">
          {shown.previous.text}
        </p>
      )}
      <Typed key={key} parts={[line.text]} pace={ACTION_PACE} className="screen__line" />
    </div>
  )
}
