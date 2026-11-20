import { useState, type CSSProperties, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { InboxImage } from './InboxImage.js'
import type { Media } from './MediaViewer.js'
import './media.css'

interface Props {
  /** Places in `items` of the pictures to show. */
  places: number[]
  items: Media[]
  onOpen: (place: number) => void
}

/** The layers a stack draws at most: the top picture and the edges of two under it. */
const STACK_LAYERS = 3

/** Small pictures in a row that wraps; a click opens the viewer on the picture. */
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

/**
 * The pictures of a folded group as one stack: the first on top, the edges of the next ones under it. A click opens
 * the viewer on the top one, its arrows go on. A picture that will not load leaves the stack; one left is a thumbnail.
 */
export function ThumbStack({ places, items, onOpen }: Props) {
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set())
  const loaded = places.filter((place) => !broken.has(place))
  const top = loaded[0]
  if (top === undefined) return null
  if (loaded.length === 1) return <Thumb item={items[top]!} onOpen={() => onOpen(top)} />
  const layers = loaded.slice(0, STACK_LAYERS)
  return (
    <button
      type="button"
      className="thumb-stack"
      style={{ '--layers': layers.length } as CSSProperties}
      title={items[top]!.name}
      aria-label={t.session.chat.openPictures(items[top]!.name, loaded.length)}
      onClick={() => onOpen(top)}
    >
      {layers.map((place, depth) => (
        <span key={place} className="thumb-stack__layer" style={{ '--depth': depth } as CSSProperties}>
          <img src={items[place]!.url} alt="" decoding="async" onError={() => setBroken((gone) => new Set(gone).add(place))} />
        </span>
      ))}
    </button>
  )
}

/**
 * A picture the user sent. Its address changes on the way — the chosen file, the service's copy, the transcript's once
 * the agent read it — and the picture on screen stays until the next address has loaded, or for good when that one
 * fails (BTN-1390). One the browser still holds shows at once; one of the service with nothing on screen yet is a file
 * chip until it loads (the service may not have it yet) and falls back to the browser's copy where there is one.
 */
export function InboxThumb({ item, onOpen }: { item: Media; onOpen: () => void }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const inbox = item.inbox === true
  const held = loaded ?? (inbox ? item.fallback ?? null : null)
  const ready = loaded === item.url
  const stale = !ready && held !== null && held !== item.url
  const failed = broken === item.url
  if (failed && !stale) return <span className="chat__file">📎 {item.name}</span>
  const onScreen = ready || stale || !inbox
  const next = stale ? 'thumb__next' : undefined
  return (
    <button type="button" className={onScreen ? 'thumb' : 'chat__file'} title={item.name} aria-label={t.session.chat.openPicture(item.name)} onClick={onOpen}>
      {!onScreen && `📎 ${item.name}`}
      {stale && <img src={held} alt="" decoding="async" />}
      {!failed && (inbox
        ? <InboxImage key={item.url} className={next} src={item.url} fallback={item.fallback} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(item.url)} />
        : <img key={item.url} className={next} src={item.url} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(item.url)} onError={() => setBroken(item.url)} />)}
    </button>
  )
}

export function Thumb({ item, onOpen, fallback = null }: { item: Media; onOpen: () => void; fallback?: ReactNode }) {
  const [broken, setBroken] = useState(false)
  if (broken) return fallback
  return (
    <button type="button" className="thumb" title={item.name} aria-label={t.session.chat.openPicture(item.name)} onClick={onOpen}>
      <img src={item.url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </button>
  )
}
