import { useRef, useState } from 'react'
import type { ProjectForm } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'

const NAME_LENGTH = 80

/**
 * The project's name after its key in the head. A click turns it into a field: Enter or leaving it saves, Esc gives up,
 * empty removes the name. The save writes `name` alone, as the settings panel writes its fields.
 */
export function ProjectName({ project, form }: { project: string; form: ProjectForm }) {
  const { send, sending, failure } = useCommand()
  const label = useProjectLabel()
  const [text, setText] = useState<string | null>(null)
  // The name on its way to the file: shown instead of the saved one until the save is answered.
  const [saving, setSaving] = useState<string | null | undefined>(undefined)
  // Esc and Enter end the edit before the field's blur does; the blur then has nothing left to save.
  const editing = useRef(false)
  const name = saving === undefined ? form.name : saving

  const start = () => {
    editing.current = true
    setText(form.name ?? '')
  }
  const finish = async (save: boolean) => {
    if (!editing.current) return
    editing.current = false
    const next = text?.trim() || null
    setText(null)
    if (!save || next === form.name) return
    setSaving(next)
    await send('project/settings', { project, ...form, name: next, base: form })
    setSaving(undefined)
  }

  return (
    <>
      {text === null ? (
        <button
          type="button"
          className={name === null ? 'project__name project__name--empty' : 'project__name'}
          title={t.project.rename(label(project))}
          disabled={sending}
          onClick={start}
        >
          {name ?? t.project.nameAdd}
        </button>
      ) : (
        <input
          className="project__name-input"
          aria-label={t.project.name}
          maxLength={NAME_LENGTH}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void finish(true)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            void finish(event.key === 'Enter')
          }}
        />
      )}
      {failure !== null && <span className="project__name-error">{say(failure)}</span>}
    </>
  )
}
