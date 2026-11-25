import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { t } from '../i18n/index.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { useNarrow } from '../layout/useNarrow.js'
import { CloseIcon, NextIcon, OpenOutIcon, PrevIcon } from '../ui/icons.js'
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

/**
 * A picture or a video over the whole window, with the neighbours by the arrows, the keys and a swipe. The arrows are
 * in a pill under the file on a wide screen and at the window's sides on a narrow one (BTN-1706).
 */
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
  const counter = items.length > 1 ? `${index + 1} / ${items.length}` : null
  const narrow = useNarrow()

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
      {narrow && prev !== null && (
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
          <FileName name={item.name} />
          {narrow ? (
            <>
              {counter && <span className="viewer__counter viewer__counter--plaque">{counter}</span>}
              <a className="viewer__open viewer__open--icon" href={item.url} target="_blank" rel="noreferrer" aria-label={t.card.viewer.original} title={t.card.viewer.original}>
                <OpenOutIcon />
              </a>
            </>
          ) : (
            <div className="viewer__controls">
              {counter && (
                <div className="viewer__pill">
                  <button type="button" className="viewer__step" aria-label={t.card.viewer.prev} title={t.card.viewer.prev} disabled={prev === null} onClick={() => go(prev)}>
                    <PrevIcon />
                  </button>
                  <span className="viewer__counter">{counter}</span>
                  <button type="button" className="viewer__step" aria-label={t.card.viewer.next} title={t.card.viewer.next} disabled={next === null} onClick={() => go(next)}>
                    <NextIcon />
                  </button>
                </div>
              )}
              <a className={counter ? 'viewer__open' : 'viewer__open viewer__open--alone'} href={item.url} target="_blank" rel="noreferrer" title={t.card.viewer.original}>
                <OpenOutIcon />
                {t.card.viewer.open}
              </a>
            </div>
          )}
        </figcaption>
      </figure>
      {narrow && next !== null && (
        <button type="button" className="viewer__nav viewer__nav--next" aria-label={t.card.viewer.next} title={t.card.viewer.next} onClick={() => go(next)}>
          ›
        </button>
      )}
    </dialog>
  )
}

/** A file name cut in its middle: the stem takes the ellipsis, the extension stays in sight. */
function FileName({ name }: { name: string }) {
  const [stem, ext] = splitName(name)
  return (
    <span className="viewer__name" title={name}>
      <span className="viewer__name-stem">{stem}</span>
      {ext && <span className="viewer__name-ext">{ext}</span>}
    </span>
  )
}

/** The stem and the extension of a name: a dot inside its last folder, not at its start. */
export function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  const base = name.lastIndexOf('/') + 1
  return dot > base ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}
