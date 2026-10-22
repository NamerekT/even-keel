import { useEffect, useState } from 'react'
import type { Share } from '../../../src/sessions/share.js'
import { t } from '../i18n/index.js'
import { SessionMarkdown } from '../ui/SessionMarkdown.js'
import { Tipped } from '../ui/Tipped.js'
import { fileName } from './feedLine.js'
import { Thumb } from './Thumbs.js'
import { sharedKind, type TranscriptMedia } from './transcriptMedia.js'
import './share.css'

/** A shared markdown file longer than this is folded. */
const FOLD_LINES = 24
const FOLD_CHARS = 2000

interface Props {
  tool: string
  share: Share
  url: (index: number) => string
  media: TranscriptMedia
  onOpen: (place: number) => void
}

/** The files a session sent the user (`SendUserFile`): its caption, markdown rendered, pictures as thumbnails, the rest to download. */
export function ShareCard({ tool, share, url, media, onOpen }: Props) {
  return (
    <div className="share">
      <span className="share__caption">{share.caption || t.session.chat.share.title}</span>
      <ul className="share__files">
        {share.files.map((file, index) => {
          const name = fileName(file)
          const kind = sharedKind(file)
          const place = media.byShare.get(`${tool}/${index}`)
          return (
            <li key={`${file}-${index}`} className={kind === 'markdown' ? 'share__doc' : undefined}>
              {kind === 'markdown' ? (
                <SharedMarkdown name={name} url={url(index)} />
              ) : kind === 'image' && place !== undefined ? (
                <Thumb item={media.items[place]!} onOpen={() => onOpen(place)} fallback={<Gone name={name} />} />
              ) : (
                <Download name={name} url={url(index)} />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A markdown file read by the page and rendered in place; a long one folds. */
function SharedMarkdown({ name, url }: { name: string; url: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setText(undefined)
    fetch(url)
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null)
      .then((found) => {
        if (alive) setText(found)
      })
    return () => {
      alive = false
    }
  }, [url])

  if (text === null) return <Gone name={name} />
  const long = text !== undefined && (text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS)
  return (
    <>
      <Download name={name} url={url} />
      {text === undefined ? (
        <span className="placeholder">{t.common.reading}</span>
      ) : (
        <div className={`share__body${long && !open ? ' share__body--folded' : ''}`}>
          <SessionMarkdown text={text} />
        </div>
      )}
      {long && (
        <button type="button" className="bubble__more" onClick={() => setOpen(!open)}>
          {open ? t.session.showLess : t.session.showMore}
        </button>
      )}
    </>
  )
}

function Download({ name, url }: { name: string; url: string }) {
  return (
    <a className="chat__file share__file" href={url} download={name} aria-label={t.session.chat.share.download(name)}>
      📎 {name}
    </a>
  )
}

/** A file the page cannot get: the worktree that held it is cleaned up, or it lies outside the session's folders. */
function Gone({ name }: { name: string }) {
  return (
    <Tipped inline focusable align="start" className="chat__file share__gone" tip={t.session.chat.share.goneTip}>
      📎 {name} · {t.session.chat.share.gone}
    </Tipped>
  )
}
