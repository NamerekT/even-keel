import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { PAGE_TOKEN } from '../../../src/secrets/catalog.js'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { CLASSIFIER, CLASSIFIER_FIELDS, classifierChanges, classifierDraft, classifierVariable, type ClassifierField } from './classifier.js'
import { fieldId, Row, Section } from './settingsParts.js'

const hintOf = (text: string, name: string, outer: boolean) => [text, t.secrets.variable(name), outer ? t.secrets.outerHint : ''].filter((part) => part !== '').join(' ')

/**
 * Settings → Interface, "Page access": the page token as a setting of its own. It sits inside the tab's draft form but
 * is never part of the draft: its button writes `.env` at once, and Enter in its field does the same instead of saving the draft.
 */
export function PageToken({ state }: { state: EvenKeelState }) {
  const apply = useCommand()
  const drop = useCommand()
  const [value, setValue] = useState('')
  const variable = state.secrets.variables.find((each) => each.name === PAGE_TOKEN)
  if (variable === undefined) return null
  const failure = apply.failure ?? drop.failure
  const busy = apply.sending || drop.sending
  const id = fieldId('pageToken')
  const save = async () => {
    if (value !== '' && (await apply.send('secrets/set', { name: PAGE_TOKEN, value }))) setValue('')
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void save()
  }

  return (
    <Row
      className="settings__field"
      label={t.secrets.token}
      hint={hintOf(t.secrets.tokenHint, PAGE_TOKEN, variable.outer)}
      htmlFor={id}
      control={
        <input
          id={id}
          className="settings__text settings__text--mono"
          type="password"
          value={value}
          placeholder={variable.set ? t.secrets.tokenSet : t.secrets.unset}
          disabled={variable.outer}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKey}
        />
      }
    >
      {!variable.outer && (value !== '' || (variable.set && !variable.required)) && (
        <div className="settings__line-extra">
          {variable.set && !variable.required && (
            <button type="button" className="button button--small" disabled={busy} onClick={() => void drop.send('secrets/remove', { name: PAGE_TOKEN })}>
              {t.secrets.remove}
            </button>
          )}
          {value !== '' && (
            <button type="button" className="button button--small button--primary" disabled={busy} onClick={() => void save()}>
              {t.secrets.save}
            </button>
          )}
        </div>
      )}
      {failure !== null && (
        <span className="settings__error" role="alert">
          {say(failure)}
        </span>
      )}
    </Row>
  )
}

const LABELS: Record<ClassifierField, () => { label: string; hint: string }> = {
  url: () => ({ label: t.secrets.llmUrl, hint: t.secrets.llmUrlHint }),
  key: () => ({ label: t.secrets.llmKey, hint: t.secrets.llmKeyHint }),
  model: () => ({ label: t.secrets.llmModel, hint: t.secrets.llmModelHint }),
}

/** Settings → Stats: Tally's span classifier, its three variables of `.env` saved together with one button. */
export function ClassifierSettings({ state }: { state: EvenKeelState }) {
  const { send, sending, failure } = useCommand()
  const { variables } = state.secrets
  const [draft, setDraft] = useState(() => classifierDraft(variables))
  const changes = classifierChanges(variables, draft)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('secrets/update', { values: changes })) setDraft({ url: draft.url.trim(), key: '', model: draft.model.trim() })
  }

  const placeholder = (field: ClassifierField, set: boolean) => (field === 'key' ? (set ? t.secrets.kept : t.secrets.unset) : field === 'model' ? t.secrets.llmModelDefault : undefined)

  return (
    <Section title={t.secrets.classifier} hint={t.secrets.classifierHint}>
      <form className="settings__fields" onSubmit={(event) => void submit(event)}>
        {CLASSIFIER_FIELDS.map((field) => {
          const variable = classifierVariable(variables, field)
          const { label, hint } = LABELS[field]()
          const id = fieldId(CLASSIFIER[field])
          return (
            <Row
              key={field}
              className="settings__field"
              label={label}
              hint={hintOf(hint, CLASSIFIER[field], variable?.outer ?? false)}
              htmlFor={id}
              control={
                <input
                  id={id}
                  className="settings__text settings__text--mono"
                  type={field === 'key' ? 'password' : 'text'}
                  value={draft[field]}
                  placeholder={placeholder(field, variable?.set ?? false)}
                  disabled={variable?.outer ?? true}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              }
            />
          )
        })}
        <div className="settings__line-extra">
          <button type="submit" className="button button--primary" disabled={sending || Object.keys(changes).length === 0}>
            {t.secrets.save}
          </button>
        </div>
        {failure !== null && (
          <p className="notice notice--error" role="alert">
            {say(failure)}
          </p>
        )}
      </form>
    </Section>
  )
}
