import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CameraIcon, CloseIcon, FileUpIcon, PasteIcon, PhotoIcon, PlusIcon, StartIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { clipboardPictures, clipboardReader } from './chatFiles.js'
import { ATTACH_SOURCES, shortStem, syncUrls, tileOf, type AttachSource, type AttachSourceId } from './fileTiles.js'
import { MediaViewer, type Media } from './MediaViewer.js'
import './composerFiles.css'
import './media.css'

const ICONS: Record<AttachSourceId, ReactNode> = { camera: <CameraIcon />, photos: <PhotoIcon />, files: <FileUpIcon /> }

/** A file's name cut to this many characters on its tile. */
const STEM = 12

function FileInput({ source, label, disabled, onFiles }: { source: AttachSource; label: string; disabled?: boolean; onFiles: (files: File[]) => void }) {
  return (
    <input
      type="file"
      accept={source.accept}
      capture={source.capture}
      multiple={source.multiple}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        const picked = [...(event.target.files ?? [])]
        event.target.value = ''
        if (picked.length > 0) onFiles(picked)
      }}
    />
  )
}

/**
 * The "+" of the chat field. With a mouse it opens the file picker at once; on a touch screen it opens a sheet of
 * Camera, Photos and Files, since a plain file input there offers the camera and the file manager but no gallery,
 * and Paste where the browser can read the clipboard: a phone keyboard's clipboard panel pastes no picture into a textarea.
 */
export function AttachButton({ sending, onAttach }: { sending: boolean; onAttach: (files: File[]) => void }) {
  const coarse = useCoarsePointer()
  const [menu, setMenu] = useState(false)
  const files = ATTACH_SOURCES.find((source) => source.id === 'files')!
  if (!coarse) {
    return (
      <Tipped inline align="start" tip={t.session.chat.attach}>
        <label className={`chat__icon chat__attach${sending ? ' chat__attach--off' : ''}`}>
          <PlusIcon />
          <FileInput source={files} label={t.session.chat.attach} disabled={sending} onFiles={onAttach} />
        </label>
      </Tipped>
    )
  }
  return (
    <>
      <button
        type="button"
        className={`chat__icon chat__attach${sending ? ' chat__attach--off' : ''}`}
        aria-label={t.session.chat.attach}
        aria-haspopup="dialog"
        disabled={sending}
        onClick={() => setMenu(true)}
      >
        <PlusIcon />
      </button>
      {menu && (
        <AttachSheet
          onClose={() => setMenu(false)}
          onPick={(picked) => {
            setMenu(false)
            onAttach(picked)
          }}
        />
      )}
    </>
  )
}

function AttachSheet({ onPick, onClose }: { onPick: (files: File[]) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const backdrop = useBackdropClose(dialog, onClose)
  const [reader] = useState(clipboardReader)
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<'empty' | 'denied' | null>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const text = t.session.chat.attachMenu
  return (
    <dialog
      ref={dialog}
      className="attach-sheet"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="attach-sheet__frame">
        <header className="attach-sheet__head">
          <h2 id={heading} className="attach-sheet__title">
            {text.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="attach-sheet__tiles">
          {ATTACH_SOURCES.map((source) => (
            <label key={source.id} className="attach-sheet__tile">
              <span className="attach-sheet__icon">{ICONS[source.id]}</span>
              {text[source.id]}
              <FileInput source={source} label={text[source.id]} onFiles={onPick} />
            </label>
          ))}
          {reader !== null && (
            <button
              type="button"
              className="attach-sheet__tile"
              aria-busy={reading || undefined}
              onClick={() => {
                if (reading) return
                setReading(true)
                setNote(null)
                void clipboardPictures(reader, new Date()).then((read) => {
                  setReading(false)
                  if ('files' in read) onPick(read.files)
                  else setNote(read.problem)
                })
              }}
            >
              <span className="attach-sheet__icon">
                <PasteIcon />
              </span>
              {text.paste}
            </button>
          )}
        </div>
        {note !== null && (
          <p className={`notice attach-sheet__note${note === 'denied' ? ' notice--error' : ''}`} role="status">
            {note === 'empty' ? text.pasteEmpty : text.pasteDenied}
          </p>
        )}
      </div>
    </dialog>
  )
}

/** Object URLs of the pictures and videos among `files`, each made once and revoked when its file leaves or the field goes. */
function useFileUrls(files: readonly File[]): ReadonlyMap<File, string> {
  const urls = useRef(new Map<File, string>())
  const [, redraw] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    if (syncUrls(urls.current, files, (file) => URL.createObjectURL(file), (url) => URL.revokeObjectURL(url))) redraw()
  }, [files])
  useEffect(() => {
    const own = urls.current
    return () => {
      for (const url of own.values()) URL.revokeObjectURL(url)
      own.clear()
    }
  }, [])
  return urls.current
}

/**
 * The files of the chat field in one strip that scrolls sideways: a picture or a video by its preview, which opens
 * in the viewer from the same object URL, any other file by its extension and name.
 */
export function FileStrip({ files, sending, onRemove }: { files: File[]; sending: boolean; onRemove: (index: number) => void }) {
  const urls = useFileUrls(files)
  const strip = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  const media: Media[] = files.flatMap((file) => {
    const url = urls.get(file)
    const { kind } = tileOf(file)
    return url === undefined || kind === 'file' ? [] : [{ kind, name: file.name, url }]
  })
  useEffect(() => {
    // The strip has no scrollbar, so it does not grow when one would appear: a mouse wheel scrolls it sideways instead.
    const box = strip.current
    if (!box) return
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || box.scrollWidth <= box.clientWidth) return
      event.preventDefault()
      box.scrollLeft += event.deltaY
    }
    box.addEventListener('wheel', wheel, { passive: false })
    return () => box.removeEventListener('wheel', wheel)
  }, [])
  return (
    <>
      <ul ref={strip} className="chat__tray">
        {files.map((file, index) => {
          const tile = tileOf(file)
          const url = urls.get(file)
          const kind = url === undefined ? 'file' : tile.kind
          return (
            <li key={`${file.name}-${index}`} className={`chat__tile chat__tile--${kind}`}>
              {kind !== 'file' && (
                <button
                  type="button"
                  className="chat__view"
                  aria-label={t.session.chat.viewFile(file.name)}
                  onClick={() => setOpen(media.findIndex((each) => each.url === url))}
                >
                  {kind === 'image' && <img className="chat__thumb" src={url} alt="" />}
                  {kind === 'video' && (
                    <>
                      <video className="chat__thumb" src={url} muted playsInline preload="metadata" aria-hidden="true" />
                      <span className="chat__play" aria-hidden="true">
                        <StartIcon />
                      </span>
                    </>
                  )}
                </button>
              )}
              {kind === 'file' && (
                <span className="chat__doc" aria-label={file.name}>
                  {tile.ext !== '' && (
                    <span className="chat__ext" aria-hidden="true">
                      {tile.ext}
                    </span>
                  )}
                  <span className="chat__stem" aria-hidden="true">
                    {shortStem(tile.stem, STEM)}
                  </span>
                </span>
              )}
              <button
                type="button"
                className="chat__unfile"
                aria-label={t.session.chat.removeFile(file.name)}
                disabled={sending}
                onClick={() => onRemove(index)}
              >
                <CloseIcon />
              </button>
            </li>
          )
        })}
      </ul>
      {open !== null && open < media.length && <MediaViewer items={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}
