import { useState, type ReactNode } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { t } from '../i18n/index.js'
import { Tipped } from '../ui/Tipped.js'
import { fileName } from './feedLine.js'
import { Thumbs } from './Thumbs.js'
import { summarize, toolKind, type Call, type EditTotal } from './toolGroups.js'
import type { TranscriptMedia } from './transcriptMedia.js'

interface Props {
  calls: Call[]
  media: TranscriptMedia
  onOpen: (place: number) => void
}

/** The calls between two texts: one line that opens into the calls, or the call itself when it is alone. */
export function ToolGroup({ calls, media, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  if (calls.length === 1) return <CallRow call={calls[0]!} media={media} onOpen={onOpen} />
  const summary = summarize(calls)
  return (
    <div className="tools">
      <div className="tools__head">
        <button type="button" className="tools__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="tools__text">{t.session.chat.tools.summary(summary.counts)}</span>
          {summary.size !== null && <EditSize {...summary.size} />}
          {summary.failed > 0 && <span className="tools__failed">{t.session.chat.tools.failed(summary.failed)}</span>}
          <Chevron />
        </button>
        {!open && <Thumbs places={calls.flatMap((call) => media.byTool.get(call.line.tool ?? '') ?? [])} items={media.items} onOpen={onOpen} />}
      </div>
      {open && (
        <ul className="tools__calls">
          {calls.map((call, index) => (
            <li key={call.line.tool ?? index}>
              <CallRow call={call} media={media} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A call: its verb and subject; the shell command and the error open under it. */
function CallRow({ call, media, onOpen }: { call: Call; media: TranscriptMedia; onOpen: (place: number) => void }) {
  const [open, setOpen] = useState(false)
  const { line, failure } = call
  const more = line.detail !== undefined || failure !== null
  const head: ReactNode = (
    <>
      <CallText line={line} />
      {(line.added !== undefined || line.removed !== undefined) && <EditSize added={line.added ?? 0} removed={line.removed ?? 0} />}
      {failure !== null && <span className="tools__failed">{t.session.chat.tools.failure}</span>}
      {more && <Chevron />}
    </>
  )
  return (
    <div className="tools">
      <div className="tools__head">
        {more ? (
          <button type="button" className="tools__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {head}
          </button>
        ) : (
          <span className="tools__toggle">{head}</span>
        )}
        <Thumbs places={media.byTool.get(line.tool ?? '') ?? []} items={media.items} onOpen={onOpen} />
      </div>
      {open && line.detail !== undefined && <pre className="tools__detail">{line.detail}</pre>}
      {open && failure !== null && <pre className="tools__detail tools__detail--failed">{failure}</pre>}
    </div>
  )
}

/** "Read fake.ts": the verb muted, the subject plain, a file by its name with the whole path in the tip. */
function CallText({ line }: { line: FeedLine }) {
  const words = t.session.chat.tools
  const kind = toolKind(line.name)
  if (kind === 'run') return <span className="tools__text">{line.subject ?? words.ran}</span>
  const verb = kind === 'read' ? words.read : kind === 'search' ? words.search : kind !== 'edit' ? null : line.name === 'Write' ? words.write : words.edit
  if (verb === null || line.subject === undefined) return <span className="tools__text">{line.text}</span>
  return (
    <span className="tools__text">
      {verb}{' '}
      {kind === 'search' ? (
        <span className="tools__subject">{line.subject}</span>
      ) : (
        <Tipped inline align="start" className="tools__subject" tip={line.subject}>
          {fileName(line.subject)}
        </Tipped>
      )}
    </span>
  )
}

/** The lines an edit adds and removes: `+21 −3`. */
export function EditSize({ added, removed }: EditTotal) {
  return (
    <span className="edit-size" aria-label={t.session.chat.tools.size(added, removed)}>
      <span className="edit-size__added">+{added}</span>
      <span className="edit-size__removed">−{removed}</span>
    </span>
  )
}

function Chevron() {
  return (
    <span className="tools__chevron" aria-hidden="true">
      ›
    </span>
  )
}
