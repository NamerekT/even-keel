import { useEffect, useId, useState } from 'react'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { taskProject } from '../state.js'
import { InheritIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { Tipped } from '../ui/Tipped.js'
import { modelOf } from '../../../src/agent/model-slots.js'
import { effortsOf, rememberModel, runPickChange, runPickOf, toggleMachine, withProvider, type RunPick } from './runPick.js'
import { accountVendor, providerName } from './settingsRun.js'
import { modelsReading, offersOf, useModelCatalog } from './useModels.js'

interface Props {
  task: string
  live: boolean
  onChanged: () => void
}

/** The mark of the provider option that follows the project: an icon, its words in the tip (BTN-1375). */
function AsProject({ value }: { value: string }) {
  return (
    <Tipped tip={t.card.run.asProjectTip(value)} inline className="task-card__as-project">
      <span role="img" aria-label={t.card.run.asProject}>
        <InheritIcon />
      </span>
    </Tipped>
  )
}

/**
 * What the task's sessions run on, as a provider, a model and an effort pick (BTN-983), and the machines of the pool
 * it is pinned to (BTN-1623): Even Keel keeps it, the tracker does not.
 */
export function TaskRunPick({ task, live, onChanged }: Props) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const project = taskProject(state, task)
  const run = state?.runs?.[project]?.[task]
  const shown = runPickOf(run)
  const [draft, setDraft] = useState<RunPick>(shown)
  const effortId = useId()
  // The model typed for each provider while the card is open: picking a provider again brings its model back (BTN-984).
  const [typed, setTyped] = useState<Record<string, string>>({})
  useEffect(() => setDraft(shown), [`${shown.provider}|${shown.model}|${shown.effort}|${(shown.machines ?? []).join(',')}`])
  // The machines it may be pinned to (BTN-1623): the project's pool, and a pinned one gone from it so it can be unticked.
  const pinned = shown.machines ?? []
  const picked = draft.machines ?? []
  const pool = state?.pools?.[project] ?? []
  const choices = [...pool, ...pinned.filter((id) => !pool.includes(id))]
  const names = state?.machineNames ?? {}
  const colors = state?.machineColors ?? {}

  const shared = state?.config.shared
  const form = state?.config.projects[project]
  const projectProvider = form?.provider ?? shared?.provider ?? ''
  const account = draft.provider === '' ? '' : (form?.accounts[draft.provider] || shared?.accounts[draft.provider]) ?? ''
  const models = useModelCatalog([account])
  const vendor = accountVendor(state?.account, account)
  const projectModel =
    draft.provider === '' ? '' : (modelOf(form?.models ?? {}, draft.provider, vendor) || modelOf(shared?.models ?? {}, draft.provider, vendor)) || t.settings.cliDefault
  const pickProvider = (provider: string) => {
    const remembered = rememberModel(typed, draft)
    setTyped(remembered)
    setDraft(withProvider(draft, provider, projectProvider, remembered))
  }
  const change = runPickChange(run, draft)
  const providers = offeredProviders(state?.account ?? null, [shown.provider, draft.provider])
  const efforts = effortsOf(draft.provider, projectProvider)
  const save = () => {
    if (change === null || sending) return
    void send('task/run', { task, ...change }).then((ok) => ok && onChanged())
  }

  // A property group of the card's side: Save stands in the label's row, so it moves nothing when it shows up.
  return (
    <div className="task-card__prop task-card__prop--wide">
      <dt className="task-card__prop-head">
        {t.card.run.title}
        {change !== null && (
          <button type="button" className="button button--small task-card__run-save" disabled={sending} onClick={save}>
            {t.card.run.save}
          </button>
        )}
      </dt>
      <dd className="task-card__run">
        <Select
          className="task-card__field"
          label={t.card.run.provider}
          value={draft.provider}
          options={[
            { value: '', label: providerName(projectProvider), aside: <AsProject value={providerName(projectProvider)} />, keywords: t.card.run.asProject },
            ...providers.map((provider) => ({ value: provider, label: providerName(provider) })),
          ]}
          disabled={sending}
          onChange={pickProvider}
        />
        {draft.provider !== '' && (
          <SuggestField
            className="task-card__field"
            label={t.card.run.model}
            value={draft.model}
            options={offersOf(models, account)}
            loading={modelsReading(models, account)}
            placeholder={projectModel}
            disabled={sending}
            onChange={(model) => setDraft({ ...draft, model })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
            }}
          />
        )}
        {efforts.length > 0 && (
          <div className="task-card__run-part">
            <label className="task-card__run-label" htmlFor={effortId}>
              {t.card.run.effort}
            </label>
            <Select
              id={effortId}
              className="task-card__field"
              value={draft.effort}
              options={[{ value: '', label: t.card.run.effortNone }, ...efforts.map((effort) => ({ value: effort, label: effort }))]}
              disabled={sending}
              onChange={(effort) => setDraft({ ...draft, effort })}
            />
          </div>
        )}
        {(choices.length > 1 || pinned.length > 0) && (
          <fieldset className="task-card__run-part task-card__machines" disabled={sending}>
            <legend className="task-card__run-label">{t.card.run.machines}</legend>
            {/* '' is "any machine of the pool": ticking it clears the list. */}
            {['', ...choices].map((id) => (
              <label key={id} className="task-card__machine">
                <input
                  type="checkbox"
                  checked={id === '' ? picked.length === 0 : picked.includes(id)}
                  onChange={() => setDraft({ ...draft, machines: id === '' ? [] : toggleMachine(picked, id) })}
                />
                {colors[id] !== undefined && <span className="machine-tag__mark" style={{ background: colors[id] }} aria-hidden="true" />}
                <span className="task-card__machine-name">{id === '' ? t.card.run.anyMachine : (names[id] ?? id)}</span>
                {id !== '' && !pool.includes(id) && (
                  <Tipped tip={t.card.run.offPoolTip} inline>
                    <span className="tag">{t.card.run.offPool}</span>
                  </Tipped>
                )}
              </label>
            ))}
          </fieldset>
        )}
        {live && change !== null && <p className="task-card__run-note">{t.card.run.live}</p>}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </dd>
    </div>
  )
}
