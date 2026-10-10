import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { t } from '../i18n/index.js'

export interface Media {
  kind: 'image' | 'video'
  name: string
  url: string
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
  const [zoomed, setZoomed] = useState(false)
  const item = items[index]!
  const prev = index > 0 ? index - 1 : null
  const next = index < items.length - 1 ? index + 1 : null

  const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    closer.current?.focus()
    return () => back?.focus()
  }, [back])

  useEffect(() => setZoomed(false), [index])

  const go = (to: number | null) => to !== null && onIndex(to)

  const swiped = (event: PointerEvent) => {
    if (swipe.current === null) return
    const dx = event.clientX - swipe.current
    swipe.current = null
    if (Math.abs(dx) < SWIPE) return
    event.preventDefault()
    go(dx > 0 ? prev : next)
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
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target === dialog.current || target.classList.contains('viewer__stage')) onClose()
      }}
    >
      <button ref={closer} type="button" className="viewer__close" aria-label={t.card.viewer.close} title={t.card.viewer.close} onClick={onClose}>
        ×
      </button>
      {prev !== null && (
        <button type="button" className="viewer__nav viewer__nav--prev" aria-label={t.card.viewer.prev} title={t.card.viewer.prev} onClick={() => go(prev)}>
          ‹
        </button>
      )}
      <figure className="viewer__stage">
        {item.kind === 'image' ? (
          <img
            key={item.url}
            src={item.url}
            alt={item.name}
            className={zoomed ? 'viewer__media viewer__media--zoomed' : 'viewer__media'}
            draggable={false}
            onPointerDown={(event) => (swipe.current = event.clientX)}
            onPointerUp={swiped}
            onClick={(event) => {
              if (!event.defaultPrevented) setZoomed((on) => !on)
            }}
          />
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
