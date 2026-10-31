import { useEffect, useState } from 'react'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { taskProject } from '../state.js'
import { Select } from '../ui/Select.js'
import { FixButton } from './FixButtons.js'
import { ModelOffers } from './ModelOffers.js'
import { runPickChange, runPickOf, type RunPick } from './runPick.js'
import { providerName } from './settingsRun.js'
import { offersOf, useModelCatalog } from './useModels.js'

interface Props {
  task: string
  /** The task's labels as the tracker spells them. */
  labels: string[]
  /** The tracker can write them; otherwise the pick only shows the label. */
  relabel: boolean
  live: boolean
  onChanged: () => void
}

/** The task's run label as a provider and a model pick (BTN-508): a save replaces every run label of the task with one. */
export function TaskRunPick({ task, labels, relabel, live, onChanged }: Props) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const view = runPickOf(labels)
  const [draft, setDraft] = useState<RunPick>(view.pick)
  const shown = `${view.pick.provider}|${view.pick.model}`
  useEffect(() => setDraft(view.pick), [shown])

  const project = taskProject(state, task)
  const shared = state?.config.shared
  const form = state?.config.projects[project]
  const projectProvider = form?.provider ?? shared?.provider ?? ''
  const account = draft.provider === '' ? '' : (form?.accounts[draft.provider] || shared?.accounts[draft.provider]) ?? ''
  const models = useModelCatalog([account])
  const projectModel = draft.provider === '' ? '' : (form?.models[draft.provider] || shared?.models[draft.provider]) || t.settings.cliDefault
  const labelsOn = form?.modelLabels ?? shared?.modelLabels ?? false
  const change = runPickChange(labels, draft)
  const providers = offeredProviders(state?.account ?? null, [view.pick.provider, draft.provider])
  const options = [
    { value: '', label: view.several && draft.provider === '' ? t.card.run.severalPick(view.labels.length) : t.card.run.asProject(providerName(projectProvider)) },
    ...providers.map((provider) => ({ value: provider, label: providerName(provider) })),
  ]
  const listId = `task-run-models-${task}`
  const save = () => {
    if (change === null || sending) return
    void send('task/labels', { task, ...change }).then((ok) => ok && onChanged())
  }

  return (
    <div className="task-card__run">
      <Select
        className="task-card__run-pick"
        label={t.card.run.provider}
        value={draft.provider}
        options={options}
        disabled={!relabel || sending}
        onChange={(provider) => setDraft({ provider, model: provider === draft.provider ? draft.model : '' })}
      />
      {draft.provider !== '' && (
        <input
          className="task-card__run-model"
          aria-label={t.card.run.model}
          spellCheck={false}
          value={draft.model}
          placeholder={t.card.run.modelAsProject(projectModel)}
          disabled={!relabel || sending}
          list={offersOf(models, account).length === 0 ? undefined : listId}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
      )}
      <ModelOffers id={listId} models={offersOf(models, account)} />
      {relabel && change !== null && (
        <button type="button" className="button button--small task-card__run-save" disabled={sending} onClick={save}>
          {t.card.run.save}
        </button>
      )}
      {view.several && <p className="task-card__run-note task-card__run-note--warn">{t.card.run.several}</p>}
      {!labelsOn && (
        <div className="task-card__run-note task-card__run-note--warn">
          <span>{t.card.run.off}</span>
          <FixButton project={project} fix={{ to: 'project', tab: 'sessions' }} />
        </div>
      )}
      {!relabel && <p className="task-card__run-note">{t.card.run.readOnly}</p>}
      {relabel && live && change !== null && <p className="task-card__run-note">{t.card.run.live}</p>}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}
