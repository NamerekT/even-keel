import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { t } from '../i18n/index.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CloseIcon } from '../ui/icons.js'
import { InboxImage } from './InboxImage.js'

export interface Media {
  kind: 'image' | 'video'
  name: string
  url: string
  /** A file the user sent, given by the service only once the transcript names it (`InboxImage` retries it). */
  inbox?: boolean
}

interface Props {
  items: Media[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

const SWIPE = 60

/** A picture or a video over the whole window, with the neighbours by the arrows, the keys and a swipe. */
export function MediaViewer({ items, index, onIndex, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const swipe = useRef<number | null>(null)
  const backdrop = useBackdropClose(dialog, onClose, (target) => target.classList.contains('viewer__stage'))
  const [zoomed, setZoomed] = useState(false)
  const item = items[index]!
  const Picture = item.inbox ? InboxImage : 'img'
  const prev = index > 0 ? index - 1 : null
  const next = index < items.length - 1 ? index + 1 : null

  const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    closer.current?.focus()
    return () => back?.focus()
  }, [back])

  useEffect(() => setZoomed(false), [index])

  // A sent picture's address may turn while it is on view; the one on screen stays until the next has loaded (BTN-1425).
  const [held, setHeld] = useState<{ name: string; url: string } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const stale = held !== null && held.name === item.name && held.url !== item.url && broken !== item.url

  const go = (to: number | null) => to !== null && onIndex(to)

  const swiped = (event: PointerEvent) => {
    if (swipe.current === null) return
    const dx = event.clientX - swipe.current
    swipe.current = null
    if (Math.abs(dx) < SWIPE) return
    event.preventDefault()
    go(dx > 0 ? prev : next)
  }

  const pictureProps = {
    alt: item.name,
    className: zoomed ? 'viewer__media viewer__media--zoomed' : 'viewer__media',
    draggable: false,
    onPointerDown: (event: PointerEvent) => (swipe.current = event.clientX),
    onPointerUp: swiped,
    onClick: (event: MouseEvent) => {
      if (!event.defaultPrevented) setZoomed((on) => !on)
    },
    ...(!item.inbox && { onError: () => setBroken(item.url) }),
  }

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={item.name}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLVideoElement) return
        if (event.key === 'ArrowLeft') go(prev)
        else if (event.key === 'ArrowRight') go(next)
      }}
      {...backdrop}
    >
      <button ref={closer} type="button" className="viewer__close" aria-label={t.card.viewer.close} title={t.card.viewer.close} onClick={onClose}>
        <CloseIcon />
      </button>
      {prev !== null && (
        <button type="button" className="viewer__nav viewer__nav--prev" aria-label={t.card.viewer.prev} title={t.card.viewer.prev} onClick={() => go(prev)}>
          ‹
        </button>
      )}
      <figure className="viewer__stage">
        {item.kind === 'image' ? (
          <>
            {stale && <img {...pictureProps} src={held.url} />}
            <Picture
              key={item.url}
              {...pictureProps}
              src={item.url}
              className={stale ? 'viewer__next' : pictureProps.className}
              onLoad={() => setHeld({ name: item.name, url: item.url })}
            />
          </>
        ) : (
          <video key={item.url} src={item.url} className="viewer__media" controls autoPlay playsInline />
        )}
        <figcaption className="viewer__caption">
          <span className="viewer__name">{item.name}</span>
          {items.length > 1 && (
            <span className="viewer__counter">
              {index + 1} / {items.length}
            </span>
          )}
          <a href={item.url} target="_blank" rel="noreferrer">
            {t.card.viewer.original} <span aria-hidden="true">↗</span>
          </a>
        </figcaption>
      </figure>
      {next !== null && (
        <button type="button" className="viewer__nav viewer__nav--next" aria-label={t.card.viewer.next} title={t.card.viewer.next} onClick={() => go(next)}>
          ›
        </button>
      )}
    </dialog>
  )
}
