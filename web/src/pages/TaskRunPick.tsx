import { useEffect, useState } from 'react'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { taskProject } from '../state.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { effortsOf, runPickChange, runPickOf, withProvider, type RunPick } from './runPick.js'
import { providerName } from './settingsRun.js'
import { offersOf, useModelCatalog } from './useModels.js'

interface Props {
  task: string
  live: boolean
  onChanged: () => void
}

/** What the task's sessions run on, as a provider, a model and an effort pick (BTN-983): Even Keel keeps it, the tracker does not. */
export function TaskRunPick({ task, live, onChanged }: Props) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const project = taskProject(state, task)
  const run = state?.runs?.[project]?.[task]
  const shown = runPickOf(run)
  const [draft, setDraft] = useState<RunPick>(shown)
  useEffect(() => setDraft(shown), [`${shown.provider}|${shown.model}|${shown.effort}`])

  const shared = state?.config.shared
  const form = state?.config.projects[project]
  const projectProvider = form?.provider ?? shared?.provider ?? ''
  const account = draft.provider === '' ? '' : (form?.accounts[draft.provider] || shared?.accounts[draft.provider]) ?? ''
  const models = useModelCatalog([account])
  const projectModel = draft.provider === '' ? '' : (form?.models[draft.provider] || shared?.models[draft.provider]) || t.settings.cliDefault
  const change = runPickChange(run, draft)
  const providers = offeredProviders(state?.account ?? null, [shown.provider, draft.provider])
  const efforts = effortsOf(draft.provider, projectProvider)
  const save = () => {
    if (change === null || sending) return
    void send('task/run', { task, ...change }).then((ok) => ok && onChanged())
  }

  return (
    <div className="task-card__run">
      <Select
        className="task-card__run-pick"
        label={t.card.run.provider}
        value={draft.provider}
        options={[
          { value: '', label: t.card.run.asProject(providerName(projectProvider)) },
          ...providers.map((provider) => ({ value: provider, label: providerName(provider) })),
        ]}
        disabled={sending}
        onChange={(provider) => setDraft(withProvider(draft, provider, projectProvider))}
      />
      {draft.provider !== '' && (
        <SuggestField
          className="task-card__run-model"
          label={t.card.run.model}
          mono
          value={draft.model}
          options={offersOf(models, account)}
          placeholder={t.card.run.modelAsProject(projectModel)}
          disabled={sending}
          onChange={(model) => setDraft({ ...draft, model })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
      )}
      {efforts.length > 0 && (
        <Select
          className="task-card__run-pick"
          label={t.card.run.effort}
          value={draft.effort}
          options={[{ value: '', label: t.card.run.effortNone }, ...efforts.map((effort) => ({ value: effort, label: t.card.run.effortOf(effort) }))]}
          disabled={sending}
          onChange={(effort) => setDraft({ ...draft, effort })}
        />
      )}
      {change !== null && (
        <button type="button" className="button button--small task-card__run-save" disabled={sending} onClick={save}>
          {t.card.run.save}
        </button>
      )}
      {live && change !== null && <p className="task-card__run-note">{t.card.run.live}</p>}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}
