import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { TaskCard as Card, TaskRef } from '../../../src/tracker/card.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { PlusIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { linkBody, linkRefusal, type LinkKind } from './cardEdit.js'
import { ErrorStrip } from './settingsParts.js'
import type { CardEditor } from './useCardEdit.js'

const SEARCH_DELAY_MS = 150

/** A linked task; one copied into another tracker (BTN-1075) names its new task under it, a link where it has an address. */
export function RefLink({ item, onOpen }: { item: TaskRef; onOpen: (task: string) => void }) {
  if (item.moved === undefined) return <RefButton item={item} onOpen={onOpen} />
  const { key, url } = item.moved
  return (
    <span className="task-card__moved-ref">
      <RefButton item={item} onOpen={onOpen} />
      <span className="task-card__moved">
        {t.transfer.movedTo}{' '}
        {url === null ? key : <a href={url} target="_blank" rel="noreferrer">{key}</a>}
      </span>
    </span>
  )
}

function RefButton({ item, onOpen }: { item: TaskRef; onOpen: (task: string) => void }) {
  return (
    <button
      type="button"
      className={`task-card__ref task-card__ref--${item.status.category}`}
      title={item.status.name}
      onClick={() => onOpen(item.id)}
    >
      <span className={`task-card__status task-card__status--${item.status.category} task-card__status--bare`}>
        <span className="task-card__dot" />
      </span>
      <span className="task-card__ref-key">{item.id}</span>
      <span className="task-card__ref-title">{item.title}</span>
    </button>
  )
}

interface SearchProps {
  /** The project GUID to look in; `null` — every project of the built-in tracker. */
  project: string | null
  label: string
  refusal: Notice | null
  onPick: (task: string) => void
  /** Escape with the list closed. */
  onClose: () => void
  /** Focused when it opens, which opens its list; `false` where a field above it is picked first. */
  focus?: boolean
}

/** A task by its key or a word of its title, asked of the service as it is typed. */
export function TaskSearch({ project, label, refusal, onPick, onClose, focus = true }: SearchProps) {
  const { query } = useLive()
  const [text, setText] = useState('')
  const [found, setFound] = useState<TaskRef[]>([])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focus) box.current?.querySelector('input')?.focus()
  }, [focus])

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      query<TaskRef[]>('builtin/search', { text, project }).then(
        (answer) => live && setFound(answer),
        () => live && setFound([]),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [text, project])

  return (
    <div ref={box} className="task-card__search">
      <ErrorStrip error={refusal} wide>
        <SuggestField
          className="task-card__field"
          label={label}
          placeholder={t.card.edit.findTask}
          value={text}
          options={found.map((each) => ({ value: each.id, label: each.moved === undefined ? each.title : `${each.title} · ${t.transfer.movedTo} ${each.moved.key}` }))}
          invalid={refusal !== null}
          onChange={setText}
          onPick={onPick}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }}
        />
      </ErrorStrip>
    </div>
  )
}

interface RelationsProps {
  card: Card
  /** `null` — the card only shows the links; its tracker is where they change. */
  editor: CardEditor | null
  onOpen: (task: string) => void
}

export function Relations({ card, editor, onOpen }: RelationsProps) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<LinkKind>('blocks')
  const [refusal, setRefusal] = useState<Notice | null>(null)
  const form = useRef<HTMLDivElement>(null)
  // The kind first: a focused search would open its list over the kind's field.
  useEffect(() => {
    if (adding) form.current?.querySelector('button')?.focus()
  }, [adding])
  const refs = [...card.blockedBy, ...card.blocks, ...card.related]
  if (refs.length === 0 && editor === null) return null
  // One key column for every group, as wide as the longest key: the titles start on one line.
  const keys = { '--ref-key': `${Math.max(0, ...refs.map((each) => each.id.length))}ch` } as CSSProperties

  const link = async (other: string) => {
    const refused = linkRefusal(card, kind, other) ?? (await editor!.run('query', 'builtin/relate', linkBody(card.id, kind, other)))
    setRefusal(refused)
    if (refused === null) setAdding(false)
  }
  const unlink = (kind: LinkKind, other: string) => (editor === null ? undefined : () => void editor.call('query', 'builtin/unrelate', linkBody(card.id, kind, other)))
  const close = () => {
    setAdding(false)
    setRefusal(null)
  }

  return (
    <div className="task-card__relations" style={keys}>
      <Refs title={t.card.blockedBy} items={card.blockedBy} onOpen={onOpen} onRemove={(other) => unlink('blockedBy', other)} />
      <Refs title={t.card.blocks} items={card.blocks} onOpen={onOpen} onRemove={(other) => unlink('blocks', other)} />
      <Refs title={t.card.related} items={card.related} onOpen={onOpen} onRemove={(other) => unlink('relates', other)} />
      {editor !== null &&
        (adding ? (
          <div ref={form} className="task-card__link-add">
            <Select
              className="task-card__field"
              label={t.card.edit.linkKind}
              value={kind}
              options={(['blocks', 'blockedBy', 'relates'] as const).map((each) => ({ value: each, label: t.card.edit.kinds[each] }))}
              onChange={(next) => {
                setKind(next as LinkKind)
                setRefusal(null)
              }}
            />
            <TaskSearch project={null} label={t.card.edit.addLink} refusal={refusal} onPick={(other) => void link(other)} onClose={close} focus={false} />
          </div>
        ) : (
          <button type="button" className="task-card__ghost" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t.card.edit.addLink}
          </button>
        ))}
    </div>
  )
}

interface RefsProps {
  title: string
  items: TaskRef[]
  onOpen: (task: string) => void
  /** The × of a row, where the card may remove the link. */
  onRemove: (task: string) => (() => void) | undefined
}

function Refs({ title, items, onOpen, onRemove }: RefsProps) {
  if (items.length === 0) return null
  return (
    <section className="task-card__group">
      <h3 className="task-card__heading">
        {title} <span className="task-card__count">{items.length}</span>
      </h3>
      <ul className="task-card__refs">
        {items.map((item) => {
          const remove = onRemove(item.id)
          return (
            <li key={item.id} className={remove === undefined ? undefined : 'task-card__ref-row'}>
              <RefLink item={item} onOpen={onOpen} />
              {remove !== undefined && <Remove label={t.card.edit.unlink(item.id)} onPress={remove} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The × that takes a link, a label or a parent off. */
export function Remove({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="task-card__remove" aria-label={label} title={label} disabled={disabled} onClick={onPress}>
      ×
    </button>
  )
}
