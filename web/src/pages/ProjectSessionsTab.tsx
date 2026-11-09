import { DEFAULT_PROTECTION } from '../../../src/sessions/protection.js'
import type { EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'
import { LANGUAGES } from '../../../src/language.js'
import { folderLabel } from '../accountName.js'
import { t } from '../i18n/index.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { TokensInput } from '../ui/TokensInput.js'
import { tokensShown } from '../ui/tokens.js'
import { PackagesButton } from './PackagesButton.js'
import { ProjectStandards } from './ProjectStandards.js'
import { ProtectionSettings } from './ProtectionSettings.js'
import { ProviderChoices } from './ProviderChoices.js'
import { SessionGets } from './SessionGets.js'
import { TrackerPackageButton } from './ToolsLink.js'
import { checkpointOf, CLI_TTL, compactWindowOf, standardRows, switchOf, WINDOW_FLAGS } from './projectForm.js'
import type { PanelFields } from './projectSettingsFields.js'
import { labelOf, standardsShown, ttlLabel } from './projectSettingsDraft.js'
import { protectionText } from './protectionDraft.js'
import { ErrorStrip, FieldHead, fieldId, FieldNote, Inherit, Row, Section, SHARE_KEYS, shareOf, sharesText } from './settingsParts.js'
import { accountOptions, providerName, WINDOW_KEYS } from './settingsRun.js'
import { offersOf, type ModelAnswer } from './useModels.js'

/** The "Sessions" tab of the project settings panel: the project's packages, the agent, the prompt, the standards, protection and context. */
export function ProjectSessionsTab({
  fields,
  project,
  form,
  state,
  shared,
  offered,
  rowAccount,
  models,
}: {
  fields: PanelFields
  project: string
  form: ProjectForm
  state: EvenKeelState | null
  shared: SharedForm
  /** The providers the agent card has rows for. */
  offered: readonly string[]
  /** The account a provider's row runs on: the project's own, else the shared one. */
  rowAccount: (provider: string) => string
  models: Record<string, ModelAnswer>
}) {
  const { draft, text, on, edit, editInherited, marks, errorOf, notes, inheritOf, pick, inheritedSwitch, lines, ownEdit, ownInherit, flagNote, number } = fields
  const sharedCheckpoint = shared.stats.checkpointTokens === null ? '' : String(shared.stats.checkpointTokens)
  const sharedShares = sharesText(shared.stats.checkpointShares)
  // The shares turned own or shared: one undo in the group's head; while they stay own, each share has its own.
  const sharesTurned = on('ownShares') !== draft.base.ownShares
  const handoffsOff = !(switchOf(text('contextHandoffs')) ?? shared.contextHandoffs)

  // A provider's compaction window, a cell of the agent card: the project's own or the shared one, empty for the agent's own window.
  const windowEmpty = (provider: string) => (provider === 'claude' ? t.shared.autoCompactWindowAccount : t.shared.codexAutoCompactWindowModel)
  const windowCell = (provider: string) => {
    const key = WINDOW_KEYS[provider]
    if (key === undefined) return null
    const flag = WINDOW_FLAGS[key]
    const empty = windowEmpty(provider)
    const sharedText = shared[key] === null ? '' : String(shared[key])
    const invalid = on(flag) && compactWindowOf(text(key)) === undefined
    return (
      <div className={marks.box([flag, key])}>
        <ErrorStrip error={invalid ? { code: `config.${key}`, params: { value: text(key) } } : errorOf(key)} wide>
          <TokensInput
            id={fieldId(key)}
            label={t.shared.autoCompactWindowOf(providerName(provider))}
            value={on(flag) ? text(key) : sharedText}
            invalid={invalid}
            placeholder={empty}
            onChange={(value) => ownEdit(flag, { [key]: sharedText })(key, value)}
          />
        </ErrorStrip>
        <Inherit {...ownInherit(flag, { [key]: sharedText }, tokensShown(sharedText) || empty)} />
      </div>
    )
  }
  const windowMark = (provider: string) => {
    const key = WINDOW_KEYS[provider]
    if (key === undefined) return null
    const empty = windowEmpty(provider)
    return flagNote(WINDOW_FLAGS[key], [key], (value) => ((value as string).trim() === '' ? empty : tokensShown(value as string)))
  }

  return (
    <>
      {state !== null && <PackagesButton project={project} packages={state.packages} />}
      <Section title={t.settings.sections.agent}>
        <ProviderChoices
          label={t.settings.provider}
          hint={t.settings.providerHint}
          className={marks.box('provider')}
          inherit={inheritOf('provider', providerName(shared.provider))}
          mark={marks.note('provider', (value) => value === '' ? t.settings.asShared(providerName(shared.provider)) : providerName(String(value)))}
          note={notes('provider')}
          chosen={text('provider') || shared.provider}
          onPick={(provider) => editInherited('provider', provider, shared.provider)}
          columns={[
            { key: 'models', label: t.settings.model, hint: t.settings.modelHint },
            { key: 'accounts', label: t.settings.account, hint: t.settings.accountHint },
            { key: 'window', label: t.shared.autoCompactWindow, hint: t.shared.autoCompactWindowColumnHint },
          ]}
          providers={offered}
          cell={(column, provider) => {
            const key = `${column}.${provider}`
            if (column === 'window') return windowCell(provider)
            if (column === 'accounts') {
              const sharedAccount = shared.accounts[provider]
              const sharedLabel = sharedAccount === undefined ? '—' : folderLabel(state?.account, sharedAccount)
              const options = [
                ...(sharedAccount === undefined ? [{ value: '', label: '—' }] : []),
                ...(state === null ? [] : accountOptions(state.account, provider, text(key) || (sharedAccount ?? ''))),
              ]
              return (
                <div className={marks.box(key)}>
                  <ErrorStrip error={errorOf(key)} wide>
                    <Select
                      id={fieldId(key)}
                      className="settings__text"
                      label={t.settings.accountOf(providerName(provider))}
                      value={text(key) || (sharedAccount ?? '')}
                      options={options}
                      invalid={errorOf(key) !== null}
                      onChange={(value) => editInherited(key, value, sharedAccount ?? '')}
                    />
                  </ErrorStrip>
                  <Inherit {...inheritOf(key, sharedLabel)} />
                </div>
              )
            }
            const offers = offersOf(models, rowAccount(provider))
            const sharedModel = shared.models[provider] ?? t.settings.cliDefault
            return (
              <div className={marks.box(key)}>
                <ErrorStrip error={errorOf(key)} wide>
                  <SuggestField
                    id={fieldId(key)}
                    className="settings__text settings__text--mono"
                    label={t.settings.modelOf(providerName(provider))}
                    mono
                    value={text(key)}
                    options={offers}
                    placeholder={sharedModel}
                    invalid={errorOf(key) !== null}
                    onChange={(value) => edit(key, value)}
                  />
                </ErrorStrip>
                <Inherit {...inheritOf(key, sharedModel)} />
              </div>
            )
          }}
          cellMark={(column, provider) => {
            const key = `${column}.${provider}`
            if (column === 'window') return windowMark(provider)
            if (column === 'models') {
              const sharedModel = shared.models[provider] ?? t.settings.cliDefault
              return marks.note(key, (value) => (value === '' ? t.settings.asShared(sharedModel) : String(value)))
            }
            const sharedAccount = shared.accounts[provider]
            const sharedLabel = sharedAccount === undefined ? '—' : folderLabel(state?.account, sharedAccount)
            const options = state === null ? [] : accountOptions(state.account, provider, text(key) || (sharedAccount ?? ''))
            return marks.note(key, (value) => (value === '' ? t.settings.asShared(sharedLabel) : labelOf(options)(value)))
          }}
        />
        {inheritedSwitch('modelLabels', t.settings.modelLabels, t.settings.modelLabelsHint, shared.modelLabels)}
      </Section>
      <Section title={t.settings.sections.prompt}>
        {pick('brief', t.settings.brief, t.settings.briefHint, [
          { value: '', label: t.settings.briefAuto },
          { value: 'true', label: t.settings.on },
          { value: 'false', label: t.settings.off },
        ])}
        {state !== null && (
          <div className="settings__line-extra">
            <TrackerPackageButton project={project} packages={state.packages} />
          </div>
        )}
        {lines('prompt', t.settings.prompt, t.settings.promptHint, t.settings.promptPlaceholder, 5, false)}
        {lines('beforeStart', t.settings.beforeStart, t.settings.beforeStartHint, t.settings.beforeStartPlaceholder, 4)}
        {pick(
          'promptLanguage',
          t.shared.promptLanguage,
          t.settings.promptLanguageHint,
          LANGUAGES.map((language) => ({ value: language, label: t.shared.languages[language] })),
          { value: shared.promptLanguage, label: t.shared.languages[shared.promptLanguage] },
        )}
      </Section>
      <Section title={t.settings.standards.title} hint={t.settings.standards.hint}>
        <ProjectStandards
          className={marks.box('standards')}
          project={project}
          branch={text('branch').trim() || form.branch}
          trim={state?.trimTools ?? false}
          value={text('standards')}
          onChange={(value) => edit('standards', value)}
          mark={marks.note('standards', standardsShown)}
        >
          {notes('standards')}
        </ProjectStandards>
      </Section>
      <Section title={t.settings.gets.title} hint={t.settings.gets.hint(providerName(text('provider') || shared.provider))}>
        <SessionGets
          project={project}
          agent={text('provider') || shared.provider}
          prompts={{ shared: (shared.prompt ?? '').trim() !== '', project: text('prompt').trim() !== '' }}
          packages={state?.packages ?? null}
          trim={state?.trimTools ?? false}
          standards={standardRows(text('standards')).map((row) => row.doc).filter((doc) => doc !== '')}
        />
      </Section>
      <ProtectionSettings value={text('protection')} shared={shared.protection ?? DEFAULT_PROTECTION} onChange={value => editInherited('protection', value, protectionText(shared.protection ?? DEFAULT_PROTECTION))} error={errorOf('protection')} mark={marks.note('protection')} />
      <Section title={t.settings.sections.context}>
        {inheritedSwitch('contextHandoffs', t.shared.contextHandoffs, t.shared.contextHandoffsHint, shared.contextHandoffs)}
        <Row
          className={marks.box(['ownCheckpoint', 'checkpointTokens'])}
          label={t.shared.checkpointTokens}
          hint={t.shared.checkpointTokensHint}
          htmlFor={fieldId('checkpointTokens')}
          inherit={ownInherit('ownCheckpoint', { checkpointTokens: sharedCheckpoint }, tokensShown(sharedCheckpoint) || t.shared.checkpointTokensPlaceholder, handoffsOff)}
          mark={flagNote('ownCheckpoint', ['checkpointTokens'], (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : tokensShown(value as string)))}
          control={
            <TokensInput
              id={fieldId('checkpointTokens')}
              value={on('ownCheckpoint') ? text('checkpointTokens') : sharedCheckpoint}
              invalid={on('ownCheckpoint') && checkpointOf(text('checkpointTokens')) === undefined}
              placeholder={t.shared.checkpointTokensPlaceholder}
              disabled={handoffsOff}
              onChange={(value) => ownEdit('ownCheckpoint', { checkpointTokens: sharedCheckpoint })('checkpointTokens', value)}
            />
          }
          error={errorOf('stats.checkpointTokens')}
        />
        <div className={marks.box('ownShares')}>
          <FieldHead
            label={t.shared.checkpointShares}
            hint={t.shared.checkpointSharesHint}
            inherit={ownInherit('ownShares', sharedShares, SHARE_KEYS.map((key) => sharedShares[key]).join(' / '), handoffsOff)}
            mark={sharesTurned ? flagNote('ownShares', SHARE_KEYS) : null}
          />
          <div className="settings__row">
            {SHARE_KEYS.map((key) => (
              <div key={key} className={marks.box(key)}>
                <FieldHead label={t.shared[key]} htmlFor={fieldId(key)} mark={sharesTurned ? null : marks.note(key)} />
                {number(key, on('ownShares') ? text(key) : sharedShares[key], on('ownShares') && shareOf(text(key)) === undefined, (value) => ownEdit('ownShares', sharedShares)(key, value), {
                  disabled: handoffsOff,
                })}
              </div>
            ))}
          </div>
          <FieldNote error={errorOf('checkpointShares')} />
        </div>
      </Section>
      <Section title={t.shared.claude}>
        {pick(
          'cacheTtl',
          t.shared.cacheTtl,
          t.shared.cacheTtlHint,
          [
            { value: CLI_TTL, label: t.shared.cacheTtlAuto },
            { value: '5m', label: t.shared.cacheTtl5m },
            { value: '1h', label: t.shared.cacheTtl1h },
          ],
          { value: shared.cacheTtl ?? CLI_TTL, label: ttlLabel(shared.cacheTtl) },
        )}
      </Section>
    </>
  )
}
