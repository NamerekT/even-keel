import { useState, type CSSProperties, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { fileName } from './feedLine.js'
import { StartIcon } from '../ui/icons.js'
import { InboxImage, InboxVideo } from './InboxImage.js'
import type { Media } from './MediaViewer.js'
import type { TranscriptMedia } from './transcriptMedia.js'
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
 * A picture the user sent. One the browser still holds keeps that address all the way (BTN-1425); without it the address
 * changes — the service's copy, the transcript's once the agent read it — and the picture on screen stays until the next
 * address has loaded, or for good when that one fails (BTN-1390). One the browser holds shows at once; one of the service
 * with nothing on screen yet is a file chip until it loads (the service may not have it yet).
 */
export function InboxThumb({ item, onOpen }: { item: Media; onOpen: () => void }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const inbox = item.inbox === true
  const ready = loaded === item.url
  const stale = !ready && loaded !== null
  const failed = broken === item.url
  if (failed && !stale) return <span className="chat__file">📎 {item.name}</span>
  const onScreen = ready || stale || !inbox
  const next = stale ? 'thumb__next' : undefined
  return (
    <button type="button" className={onScreen ? 'thumb' : 'chat__file'} title={item.name} aria-label={t.session.chat.openPicture(item.name)} onClick={onOpen}>
      {!onScreen && `📎 ${item.name}`}
      {stale && <img src={loaded} alt="" decoding="async" />}
      {!failed && (inbox
        ? <InboxImage key={item.url} className={next} src={item.url} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(item.url)} />
        : <img key={item.url} className={next} src={item.url} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(item.url)} onError={() => setBroken(item.url)} />)}
    </button>
  )
}

/**
 * A video the user sent (BTN-1704): its first frame with ▶, as in the chat field. The agent never reads a video, so past
 * the browser's copy its only address is the service's one of the inbox file, gone once the worktree is cleaned up: then
 * it is a file chip with no player, unless a frame is on screen already. Like `InboxThumb`, the frame on screen stays
 * while a next address loads.
 */
export function VideoThumb({ item, onOpen }: { item: Media; onOpen: () => void }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const ready = loaded === item.url
  const stale = !ready && loaded !== null
  const failed = broken === item.url && !ready
  if (failed && !stale) return <span className="chat__file">📎 {item.name}</span>
  const onScreen = ready || stale || item.inbox !== true
  const frame = { muted: true, playsInline: true, preload: 'metadata', 'aria-hidden': true } as const
  const next = stale ? 'thumb__next' : undefined
  const shown = () => setLoaded(item.url)
  return (
    <button type="button" className={onScreen ? 'thumb' : 'chat__file'} title={item.name} aria-label={t.session.chat.openPicture(item.name)} onClick={onOpen}>
      {!onScreen && `📎 ${item.name}`}
      {stale && <video {...frame} src={loaded} />}
      {!failed && (item.inbox === true
        ? <InboxVideo key={item.url} {...frame} className={next} src={item.url} onLoadedMetadata={shown} />
        : <video key={item.url} {...frame} className={next} src={item.url} onLoadedMetadata={shown} onError={() => setBroken(item.url)} />)}
      {onScreen && (
        <span className="chat__play" aria-hidden="true">
          <StartIcon />
        </span>
      )}
    </button>
  )
}

/**
 * The files of a message the user sent — in the feed or still in the mailbox (BTN-1431): pictures and videos as
 * thumbnails, the rest as names. By place alone: the sent line names a file by its name, the transcript's by its path (BTN-1390).
 */
export function SentFiles({ files, media, onOpen }: { files: string[]; media: TranscriptMedia; onOpen: (place: number) => void }) {
  if (files.length === 0) return null
  return (
    <ul className="bubble__files">
      {files.map((file, index) => {
        const place = media.byFile.get(file)
        const item = place === undefined ? undefined : media.items[place]!
        const Shown = item?.kind === 'video' ? VideoThumb : InboxThumb
        return (
          <li key={index}>
            {item === undefined ? <span className="chat__file">📎 {fileName(file)}</span> : <Shown item={item} onOpen={() => onOpen(place!)} />}
          </li>
        )
      })}
    </ul>
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
