import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
import { PlusIcon, SendIcon, SlashIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { useChatDraft, type DraftOwner } from './useChatDraft.js'
import { takenFiles } from './chatFiles.js'
import { sendsReply } from './chatKeys.js'
import { CommandText, type CommandTextHandle } from './CommandText.js'

interface BoxProps {
  command: RefObject<CommandTextHandle | null>
  text: string
  files: File[]
  sending: boolean
  rows: number
  onText: (text: string) => void
  onFiles: (change: (now: File[]) => File[]) => void
  /** The send button, with its tip. */
  send: ReactNode
  /** `false` — no slash button and no commands menu (a project chat). */
  commands?: boolean
}

/** The field of a chat with its files, attach and command buttons and the send button: the same in an open and a shut chat. */
export function ComposerBox({ command, text, files, sending, rows, onText, onFiles, send, commands = true }: BoxProps) {
  const coarsePointer = useCoarsePointer()
  // A command goes only at the start of the message, so the button inserts one into an empty field only.
  const slashFree = text.trim() === '' && !sending
  const attach = (more: File[]) => {
    if (!sending) onFiles((now) => [...now, ...more])
  }
  return (
    <div className="chat__box">
      {files.length > 0 && (
        <ul className="chat__files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="chat__file">
              {file.name}
              <button
                type="button"
                className="chat__unfile"
                aria-label={t.session.chat.removeFile(file.name)}
                disabled={sending}
                onClick={() => onFiles((now) => now.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat__row">
        <Tipped inline align="start" tip={t.session.chat.attach}>
          <label className={`chat__icon chat__attach${sending ? ' chat__attach--off' : ''}`}>
            <PlusIcon />
            <input
              type="file"
              multiple
              disabled={sending}
              aria-label={t.session.chat.attach}
              onChange={(event) => {
                attach([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </label>
        </Tipped>
        {/* A field already starting with a command keeps the plain tip: the press that put it there leaves the tip open. */}
        {commands && (
          <Tipped inline align="start" tip={slashFree || text.startsWith('/') ? t.session.chat.slash : t.session.chat.slashTaken}>
            <button
              type="button"
              className="chat__icon chat__slash"
              aria-label={t.session.chat.slash}
              aria-disabled={slashFree ? undefined : true}
              onClick={() => {
                if (slashFree) command.current?.startCommand()
              }}
            >
              <SlashIcon />
            </button>
          </Tipped>
        )}
        <CommandText
          handle={command}
          commands={commands}
          rows={rows}
          value={text}
          disabled={sending}
          placeholder={t.session.chat.placeholder}
          onChange={onText}
          onPaste={(event) => {
            // Text goes into the field as usual; a picture or files copied in Explorer go into the list.
            const pasted = takenFiles(event.clipboardData.items, new Date())
            if (pasted.length > 0) attach(pasted)
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!sendsReply(event.nativeEvent, coarsePointer)) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />
        {send}
      </div>
    </div>
  )
}

interface ShutProps {
  owner: DraftOwner
  sessionId: string
  /** Why nothing can be sent from here. */
  reason: string
  /** The session's status line, under the field. */
  status?: ReactNode
}

/**
 * The composer of a transcript window that answers nothing — a session that is not the task's current one, or the
 * task is closed: the field keeps the task's draft and takes more, the send button stays off with the reason under it.
 */
export function ShutComposer({ owner, sessionId, reason, status }: ShutProps) {
  const command = useRef<CommandTextHandle>(null)
  const { text, files, setText, setFiles } = useChatDraft(owner, sessionId)
  return (
    <form className="chat" onSubmit={(event) => event.preventDefault()}>
      <ComposerBox
        command={command}
        text={text}
        files={files}
        sending={false}
        rows={2}
        onText={setText}
        onFiles={setFiles}
        send={
          <button type="submit" className="chat__icon chat__send" disabled aria-label={t.session.chat.send}>
            <SendIcon />
          </button>
        }
      />
      {status}
      <p className="chat__hint">{reason}</p>
    </form>
  )
}
