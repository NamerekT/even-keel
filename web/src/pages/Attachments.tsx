import { useState } from 'react'
import type { TaskCard } from '../../../src/tracker/card.js'
import { t } from '../i18n/index.js'
import { MediaViewer, type Media } from './MediaViewer.js'
import './media.css'

type Attachment = TaskCard['attachments'][number]

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i

export function kindOf({ type, name }: Pick<Attachment, 'type' | 'name'>): Media['kind'] | 'file' {
  if (type.startsWith('image/') || (type === '' && IMAGE.test(name))) return 'image'
  if (type.startsWith('video/') || (type === '' && VIDEO.test(name))) return 'video'
  return 'file'
}

/** Tiles under the task's facts; a picture or a video opens in the viewer, any other file downloads. */
export function Attachments({ items }: { items: Attachment[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const media: Media[] = items.flatMap((item) => {
    const kind = kindOf(item)
    return kind === 'file' ? [] : [{ kind, name: item.name, url: item.url }]
  })

  return (
    <section className="task-card__group task-card__attachments">
      <h3 className="task-card__heading">
        {t.card.attachments} <span className="task-card__count">{items.length}</span>
      </h3>
      <ul className="tiles">
        {items.map((item) => {
          const kind = kindOf(item)
          const at = media.findIndex((each) => each.url === item.url)
          return (
            <li key={item.file}>
              {kind === 'file' ? (
                <a className="tile tile--file" href={item.url} download={item.name} title={item.name} aria-label={t.card.download(item.name)}>
                  <span className="tile__ext">{extensionOf(item.name)}</span>
                  <span className="tile__name">{item.name}</span>
                </a>
              ) : (
                <button type="button" className={`tile tile--${kind}`} title={item.name} onClick={() => setOpen(at)}>
                  {kind === 'image' ? (
                    <img src={item.url} alt={item.name} loading="lazy" decoding="async" />
                  ) : (
                    <>
                      <span className="tile__play" aria-hidden="true" />
                      <span className="tile__name">{item.name}</span>
                    </>
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {open !== null && <MediaViewer items={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  )
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1) : '…'
}
