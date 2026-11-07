import { useState } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { TaskCard } from '../../../src/tracker/card.js'
import { say, t } from '../i18n/index.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { TrashIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { MediaViewer, type Media } from './MediaViewer.js'
import type { CardEditor } from './useCardEdit.js'
import './media.css'

type Attachment = TaskCard['attachments'][number]

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i

export function kindOf({ type, name }: Pick<Attachment, 'type' | 'name'>): Media['kind'] | 'file' {
  if (type.startsWith('image/') || (type === '' && IMAGE.test(name))) return 'image'
  if (type.startsWith('video/') || (type === '' && VIDEO.test(name))) return 'video'
  return 'file'
}

interface Props {
  task: string
  items: Attachment[]
  /** The built-in tracker's card, editable: each attachment with a record gets its delete button (BTN-773). */
  editor: CardEditor | null
}

/** Tiles under the task's facts, its name and size under each; a picture or a video opens in the viewer, any other file downloads. */
export function Attachments({ task, items, editor }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const [removing, setRemoving] = useState<Attachment | null>(null)
  const shown = (item: Attachment) => item.missing !== true
  const media: Media[] = items.flatMap((item) => {
    const kind = kindOf(item)
    return kind === 'file' || !shown(item) ? [] : [{ kind, name: item.name, url: item.url }]
  })

  return (
    <section className="task-card__group task-card__attachments">
      <h3 className="task-card__heading">
        {t.card.attachments} <span className="task-card__count">{items.length}</span>
      </h3>
      <ul className="tiles">
        {items.map((item) => (
          <li key={item.id ?? item.file} className="tiles__item">
            <Tile item={item} onOpen={() => setOpen(media.findIndex((each) => each.url === item.url))} />
            <span className="tile__caption">
              <span className="tile__caption-name" title={item.name}>
                {item.name}
              </span>
              <span className="tile__size">{t.card.attachment.size(item.size)}</span>
            </span>
            {editor !== null && item.id !== undefined && (
              <button
                type="button"
                className="task-card__remove tile__remove"
                aria-label={t.card.attachment.remove(item.name)}
                title={t.card.attachment.remove(item.name)}
                disabled={editor.busy}
                onClick={() => setRemoving(item)}
              >
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
      {open !== null && <MediaViewer items={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {removing !== null && editor !== null && <RemoveAttachment task={task} item={removing} editor={editor} onClose={() => setRemoving(null)} />}
    </section>
  )
}

function Tile({ item, onOpen }: { item: Attachment; onOpen: () => void }) {
  if (item.missing === true) {
    return (
      <Tipped tip={t.card.attachment.missingTip(item.name)} focusable className="tile tile--file tile--missing">
        <span className="tile__ext">{extensionOf(item.name)}</span>
        <span className="tile__name">{t.card.attachment.missing}</span>
      </Tipped>
    )
  }
  const kind = kindOf(item)
  if (kind === 'file') {
    return (
      <a className="tile tile--file" href={item.url} download={item.name} title={item.name} aria-label={t.card.download(item.name)}>
        <span className="tile__ext">{extensionOf(item.name)}</span>
      </a>
    )
  }
  return (
    <button type="button" className={`tile tile--${kind}`} title={item.name} onClick={onOpen}>
      {kind === 'image' ? <img src={item.url} alt={item.name} loading="lazy" decoding="async" /> : <span className="tile__play" aria-hidden="true" />}
    </button>
  )
}

function RemoveAttachment({ task, item, editor, onClose }: { task: string; item: Attachment; editor: CardEditor; onClose: () => void }) {
  const [failure, setFailure] = useState<Notice | null>(null)
  return (
    <ConfirmDialog
      title={t.card.attachment.removeTitle}
      question={t.card.attachment.removeQuestion(item.name)}
      confirm={t.card.journal.removeConfirm}
      cancel={t.card.edit.cancel}
      busy={editor.busy}
      failure={failure === null ? undefined : say(failure)}
      onConfirm={() => void editor.run('query', 'builtin/detach', { task, file: item.id }).then((refused) => (refused === null ? onClose() : setFailure(refused)))}
      onClose={onClose}
    />
  )
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1) : '…'
}
