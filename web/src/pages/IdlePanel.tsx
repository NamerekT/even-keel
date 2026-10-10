import { useState } from 'react'
import { t } from '../i18n/index.js'

const BOAT = String.raw`
        |\
        | \
        |  \
        |   \
        |____\
  \_____|_______/
~~~~~~~~~~~~~~~~~~~~~
`.slice(1)

/** Holds the side column while no panel is open, so the chain keeps its width. */
export function IdlePanel() {
  const [meme] = useState(() => t.project.idle.memes[Math.floor(Math.random() * t.project.idle.memes.length)])

  return (
    <aside className="idle">
      <pre className="idle__boat" aria-hidden="true">
        {BOAT}
      </pre>
      <p className="idle__meme">{meme}</p>
      <p className="idle__hint">{t.project.idle.hint}</p>
    </aside>
  )
}
