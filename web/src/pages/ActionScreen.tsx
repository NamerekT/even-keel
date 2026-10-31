import { useState } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { say } from '../i18n/index.js'
import { Typed } from '../ui/Typed.js'

const ACTION_PACE = { charMs: 12, pauseMs: 0 }

/**
 * The current action of the lead block on a small screen: a new line types in while the previous one scrolls away.
 * `delay` holds the first line back, so a block being taken prints only once its frame is drawn.
 */
export function ActionScreen({ line, delay = 0 }: { line: FeedLine; delay?: number }) {
  const key = `${line.at} ${line.text}`
  const [shown, setShown] = useState<{ key: string; line: FeedLine; previous: FeedLine | null }>({ key, line, previous: null })
  if (shown.key !== key) setShown({ key, line, previous: shown.line })
  const text = textOf(line)

  return (
    <div className={`block__action screen screen--${line.kind}`} title={text}>
      {shown.previous !== null && (
        <p key={`out ${key}`} className="screen__line screen__line--out" aria-hidden="true">
          {textOf(shown.previous)}
        </p>
      )}
      <Typed key={key} parts={[text]} pace={ACTION_PACE} className="screen__line" delay={shown.previous === null ? delay : 0} />
    </div>
  )
}

/** A service diagnostic is translated, as in the transcript. */
function textOf(line: FeedLine): string {
  return line.notice === undefined ? line.text : say(line.notice)
}
