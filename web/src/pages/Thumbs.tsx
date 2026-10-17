import { useState, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import type { Media } from './MediaViewer.js'
import './media.css'

interface Props {
  /** Places in `items` of the pictures to show. */
  places: number[]
  items: Media[]
  onOpen: (place: number) => void
}

/** Small pictures in a row; a click opens the viewer on the picture. */
export function Thumbs({ places, items, onOpen }: Props) {
  if (places.length === 0) return null
  return (
    <span className="thumbs">
      {places.map((place) => (
        <Thumb key={place} item={items[place]!} onOpen={() => onOpen(place)} />
      ))}
    </span>
  )
}

/** `fallback` stands in for a picture that will not load: a sent file a cleaned-up worktree took with it. */
export function Thumb({ item, onOpen, fallback = null }: { item: Media; onOpen: () => void; fallback?: ReactNode }) {
  const [broken, setBroken] = useState(false)
  if (broken) return fallback
  return (
    <button type="button" className="thumb" title={item.name} aria-label={t.session.chat.openPicture(item.name)} onClick={onOpen}>
      <img src={item.url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </button>
  )
}
