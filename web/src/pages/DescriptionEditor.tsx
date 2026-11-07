import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { useDeferredValue, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import type { AttachedFile } from '../live/connection.js'
import { Segmented } from '../stats/common.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Tipped } from '../ui/Tipped.js'
import { descriptionExtensions, editorMarkdown, htmlToMarkdown, previewLoss, toDoc, type PreviewLoss } from './descriptionDoc.js'
import { meaningfulHtml } from './descriptionPaste.js'
import { takenFiles } from './chatFiles.js'
import { NoticeFixButton } from './FixButtons.js'
import { useFileDrop } from './useFileDrop.js'
import { useUploads } from './useUploads.js'
import '../stats/overview.css'
import './description.css'

/** One choice for every card, as the changelog's. */
type Look = 'preview' | 'markdown'
const LOOK_KEY = 'even-keel.description.look'

function storedLook(): Look {
  try {
    return localStorage.getItem(LOOK_KEY) === 'markdown' ? 'markdown' : 'preview'
  } catch {
    return 'preview'
  }
}

interface Props {
  /** The description when the edit began: what the save names as its start, and what "no changes" means. */
  start: string
  text: string
  /** Grows when the text is replaced from outside ("put mine back"): the visual editor is built anew on it. */
  revision: number
  busy: boolean
  failure: Notice | null
  /** The largest file the service takes, bytes: a larger one is refused here, before its bytes go anywhere. */
  limit: number
  onText: (text: string) => void
  onUpload: (file: File) => Promise<AttachedFile>
  onSave: () => void
  onClose: () => void
}

/**
 * The description's editor (BTN-772), in its own chunk so TipTap is loaded only when a description is edited. The text is
 * always Markdown: the visual editor writes it only on a real edit, so opening and closing it changes nothing.
 */
export function DescriptionEditor({ start, text, revision, busy, failure, limit, onText, onUpload, onSave, onClose }: Props) {
  const [look, setLook] = useState<Look>(() => (previewLoss(text) === null ? storedLook() : 'markdown'))
  const [asking, setAsking] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const uploads = useUploads({ text, limit, onText, onUpload, field })
  const drop = useFileDrop(true, (files) => attach(files))
  const checked = useDeferredValue(text)
  const loss = useMemo(() => (look === 'markdown' ? previewLoss(checked) : null), [look, checked])
  const dirty = text !== start

  const pickLook = (next: Look) => {
    if (next === 'preview' && previewLoss(text) !== null) return
    setLook(next)
    try {
      localStorage.setItem(LOOK_KEY, next)
    } catch {
      // A browser that keeps no storage keeps the choice until the page reloads.
    }
  }
  const change = (next: string) => uploads.write(next)
  const leave = () => (dirty ? setAsking(true) : onClose())
  const save = () => {
    if (!busy && uploads.pending === 0) onSave()
  }
  // The visual editor has no pictures: a file pasted or dropped there opens the Markdown, the mark goes at its end.
  const attach = (files: File[]) => {
    if (look === 'markdown') return uploads.start(files, field.current)
    setLook('markdown')
    uploads.start(files, null)
  }

  // Before the visual editor's own keys: its Mod-Enter would put a line break in first.
  const saveKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopPropagation()
    save()
  }
  // The card's dialog closes on Escape: here it leaves the editor instead. ProseMirror marks Escape as handled, so
  // `defaultPrevented` says nothing; the link's field stops its own Escape before it gets here.
  const escapeKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    leave()
  }
  // Taken before the field and the visual editor see it: neither would do anything with a file.
  const pasteFiles = (event: ClipboardEvent) => {
    const files = takenFiles(event.clipboardData.items, new Date())
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    attach(files)
  }
  const dropFiles = (event: DragEvent<HTMLElement>) => {
    drop.handlers.onDrop(event)
    if (event.defaultPrevented) event.stopPropagation()
  }

  return (
    <>
      <div
        className="description"
        onKeyDownCapture={saveKey}
        onKeyDown={escapeKey}
        onPasteCapture={pasteFiles}
        onDragEnter={drop.handlers.onDragEnter}
        onDragOver={drop.handlers.onDragOver}
        onDragLeave={drop.handlers.onDragLeave}
        onDropCapture={dropFiles}
      >
        {drop.over && (
          <div className="description__drop" aria-hidden="true">
            {t.card.edit.describe.drop}
          </div>
        )}
        <div className="description__head">
          <h3 className="task-card__heading">{t.card.description}</h3>
          <Tipped tip={loss === null ? '' : t.card.edit.describe.blocked[loss]} off={loss === null} focusable={loss !== null}>
            <LookSwitch look={look} blocked={loss} onChange={pickLook} />
          </Tipped>
        </div>
        {look === 'preview' ? (
          <VisualEditor key={revision} start={start} text={text} onText={change} />
        ) : (
          <MarkdownEditor field={field} text={text} onText={change} />
        )}
        {uploads.failure !== null && (
          <p className="notice notice--error description__note">
            {say(uploads.failure)} <NoticeFixButton project={null} notice={uploads.failure} />
          </p>
        )}
        {failure !== null && <p className="notice notice--error description__note">{say(failure)}</p>}
        <div className="description__foot">
          <span className="description__hint">{uploads.pending > 0 ? t.card.edit.describe.uploadWait : t.card.edit.describe.saveTipFiles}</span>
          <span className="description__spacer" />
          <button type="button" className="button" disabled={busy} onClick={leave}>
            {t.card.edit.cancel}
          </button>
          <button type="button" className="button button--primary" disabled={busy || uploads.pending > 0} aria-busy={busy || uploads.pending > 0} onClick={save}>
            {t.card.edit.describe.save}
          </button>
        </div>
      </div>
      {asking && (
        <ConfirmDialog
          title={t.card.edit.describe.discardTitle}
          question={t.card.edit.describe.discardQuestion}
          confirm={t.card.edit.describe.discard}
          cancel={t.card.edit.describe.discardCancel}
          busy={false}
          onConfirm={() => {
            setAsking(false)
            onClose()
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}

/** The mode switch; a blocked Preview stays in place, greyed, with the reason in the tip around it. */
function LookSwitch({ look, blocked, onChange }: { look: Look; blocked: PreviewLoss | null; onChange: (look: Look) => void }) {
  return (
    <Segmented
      label={t.card.edit.describe.look}
      options={[
        ['preview', t.card.edit.describe.preview],
        ['markdown', t.card.edit.describe.markdown],
      ]}
      value={look}
      blocked={blocked === null ? [] : ['preview']}
      onChange={onChange}
    />
  )
}

/** The Markdown itself; HTML pasted from a page, a tracker or Word comes in as Markdown, a code editor's copy as its text. */
function MarkdownEditor({ field, text, onText }: { field: RefObject<HTMLTextAreaElement | null>; text: string; onText: (text: string) => void }) {
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData('text/html')
    if (!meaningfulHtml(html)) {
      // A picture of a web page comes as HTML with no file: there are no bytes to attach, nothing goes in.
      if (event.clipboardData.getData('text/plain') === '') event.preventDefault()
      return
    }
    event.preventDefault()
    const field = event.currentTarget
    const markdown = htmlToMarkdown(html)
    // `insertText` keeps the field's own undo; without it the text is set directly.
    if (!document.execCommand('insertText', false, markdown)) {
      field.setRangeText(markdown, field.selectionStart, field.selectionEnd, 'end')
      onText(field.value)
    }
  }
  return (
    <textarea
      ref={field}
      className="description__box description__source"
      value={text}
      placeholder={t.card.edit.describe.placeholder}
      aria-label={t.card.description}
      spellCheck
      autoFocus
      onChange={(event) => onText(event.target.value)}
      onPaste={paste}
    />
  )
}

/** The rendered description, edited in place; the toolbar covers what Markdown has. */
function VisualEditor({ start, text, onText }: { start: string; text: string; onText: (text: string) => void }) {
  const write = useRef(onText)
  write.current = onText
  // The start as the editor would write it: an edit undone back to it is the start again, not a change.
  const clean = useMemo(() => editorMarkdown(toDoc(start)), [start])
  const editor = useEditor({
    extensions: descriptionExtensions([Placeholder.configure({ placeholder: t.card.edit.describe.placeholder }), StopHardBreakSave]),
    content: toDoc(text),
    // At the top, as the Markdown field opens: a long description stays where it was being read.
    autofocus: 'start',
    editorProps: { attributes: { 'aria-label': t.card.description, class: 'markdown task-card__markdown description__visual' } },
    onUpdate: ({ editor: changed }) => {
      const markdown = editorMarkdown(changed.getJSON())
      write.current(markdown === clean ? start : markdown)
    },
  })
  return (
    <>
      <Toolbar editor={editor} />
      <div className="description__box description__scroll">
        <EditorContent editor={editor} />
      </div>
    </>
  )
}

/** Mod-Enter is the save (taken above the editor); the hard break keeps Shift-Enter. */
const StopHardBreakSave = Extension.create({
  name: 'descriptionSaveKey',
  priority: 1000,
  addKeyboardShortcuts: () => ({ 'Mod-Enter': () => true }),
})

const MARKS = ['bold', 'italic', 'strike', 'code'] as const

function Toolbar({ editor }: { editor: Editor }) {
  const words = t.card.edit.describe
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      heading: e.isActive('heading', { level: 2 }),
      subheading: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      checklist: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  })
  const [linking, setLinking] = useState<string | null>(null)
  const chain = () => editor.chain().focus()
  const marks: Record<(typeof MARKS)[number], () => void> = {
    bold: () => chain().toggleBold().run(),
    italic: () => chain().toggleItalic().run(),
    strike: () => chain().toggleStrike().run(),
    code: () => chain().toggleCode().run(),
  }
  const openLink = () => setLinking((editor.getAttributes('link').href as string | undefined) ?? '')
  const applyLink = (href: string) => {
    setLinking(null)
    if (href.trim() === '') chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }

  return (
    <div className="description__tools" role="toolbar" aria-label={words.tools}>
      {MARKS.map((mark) => (
        <Tool key={mark} label={words[mark]} active={on[mark]} onPress={marks[mark]}>
          <span className={`description__glyph description__glyph--${mark}`}>{GLYPHS[mark]}</span>
        </Tool>
      ))}
      <span className="description__divider" />
      <Tool label={words.heading} active={on.heading} onPress={() => chain().toggleHeading({ level: 2 }).run()}>
        H2
      </Tool>
      <Tool label={words.subheading} active={on.subheading} onPress={() => chain().toggleHeading({ level: 3 }).run()}>
        H3
      </Tool>
      <span className="description__divider" />
      <Tool label={words.bullets} active={on.bullets} onPress={() => chain().toggleBulletList().run()}>
        <ListIcon />
      </Tool>
      <Tool label={words.numbers} active={on.numbers} onPress={() => chain().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label={words.checklist} active={on.checklist} onPress={() => chain().toggleTaskList().run()}>
        <CheckIcon />
      </Tool>
      <Tool label={words.quote} active={on.quote} onPress={() => chain().toggleBlockquote().run()}>
        ❝
      </Tool>
      <Tool label={words.codeBlock} active={on.codeBlock} onPress={() => chain().toggleCodeBlock().run()}>
        {'{ }'}
      </Tool>
      <Tool label={words.table} active={on.table} onPress={() => chain().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>
        <TableIcon />
      </Tool>
      <span className="description__divider" />
      {linking === null ? (
        <Tool label={words.link} active={on.link} onPress={openLink}>
          <LinkIcon />
        </Tool>
      ) : (
        <LinkField value={linking} onApply={applyLink} onCancel={() => setLinking(null)} />
      )}
    </div>
  )
}

const GLYPHS = { bold: 'B', italic: 'I', strike: 'S', code: '</>' }

function Tool({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Tipped tip={label} inline>
      <button
        type="button"
        className={active ? 'description__tool description__tool--on' : 'description__tool'}
        aria-label={label}
        aria-pressed={active}
        // The editor keeps its selection: a press must not take the focus from it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPress}
      >
        {children}
      </button>
    </Tipped>
  )
}

function LinkField({ value, onApply, onCancel }: { value: string; onApply: (href: string) => void; onCancel: () => void }) {
  const [href, setHref] = useState(value)
  const words = t.card.edit.describe
  return (
    <span className="description__link">
      <input
        className="description__link-field"
        type="url"
        value={href}
        placeholder="https://"
        aria-label={words.linkUrl}
        autoFocus
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onApply(href)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <button type="button" className="button button--small" onClick={() => onApply(href)}>
        {words.linkApply}
      </button>
      {value !== '' && (
        <button type="button" className="button button--small" onClick={() => onApply('')}>
          {words.linkRemove}
        </button>
      )}
    </span>
  )
}

const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true } as const

function ListIcon() {
  return (
    <svg {...ICON}>
      <circle cx="3" cy="4" r="0.75" fill="currentColor" />
      <circle cx="3" cy="8" r="0.75" fill="currentColor" />
      <circle cx="3" cy="12" r="0.75" fill="currentColor" />
      <path d="M6 4h8M6 8h8M6 12h8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...ICON}>
      <rect x="2" y="2.5" width="5" height="5" rx="1" />
      <path d="M3.3 5l1 1 1.6-1.8M9.5 5H14M2 11.5h5M9.5 11.5H14" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg {...ICON}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M7 3v10" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg {...ICON}>
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" />
    </svg>
  )
}
