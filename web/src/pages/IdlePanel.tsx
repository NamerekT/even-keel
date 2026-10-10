import { useState } from 'react'
import { t } from '../i18n/index.js'
import { Voyage } from './Voyage.js'

/** Holds the side column while no panel is open, so the chain keeps its width. */
export function IdlePanel() {
  const [meme] = useState(() => t.project.idle.memes[Math.floor(Math.random() * t.project.idle.memes.length)])

  return (
    <aside className="idle">
      <Voyage />
      <p className="idle__meme">{meme}</p>
      <p className="idle__hint">{t.project.idle.hint}</p>
    </aside>
  )
}
