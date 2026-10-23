import { useId, useState } from 'react'
import { sameName, type ChainRules } from '../../../src/chain/rules.js'
import type { Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import { PlusIcon, TrashIcon, UndoIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import {
  labelRows,
  milestoneModeOf,
  settled,
  statusRows,
  withLabel,
  withMilestoneMode,
  withPlace,
  type KnownStatus,
  type LabelRow,
  type MilestoneMode,
  type RuleLevel,
  type RuleOrigin,
  type StatusPlace,
  type StatusRow,
} from './ruleRows.js'
import { FieldHead, FieldNote, HelpTip, Section, type Marks, type RuleKey } from './settingsParts.js'
import { withoutListed } from './settingsRows.js'
import { ListTable } from './settingsTable.js'
import './ruleForm.css'

const PLACES: readonly StatusPlace[] = ['in', 'out', 'closed']
const MODES: readonly MilestoneMode[] = ['all', 'only', 'except']

export interface RuleFormProps {
  /** The level the form sets: its own rows get a reset, the inherited ones are muted. */
  level: RuleLevel
  /** The rules in force at the level, as the draft has them. */
  rules: ChainRules
  /** What the level gets without its own keys: what a reset puts back. */
  inherited: ChainRules
  origins: Record<keyof ChainRules, RuleLevel>
  /** The profile the rows of `profile` origin come from. */
  profileName: string | null
  statuses: readonly KnownStatus[]
  /** The labels offered as one adds a label. */
  labels: readonly string[]
  /** Run labels pick a model: they are shown among the built-in ones. */
  modelLabels: boolean
  /** The keys one edit changes, together: a status that moves may leave one list for another. */
  onEdit: (changes: RuleChange[]) => void
  errorOf: (field: string) => Notice | null
  marks: Marks
  hint?: string
}

/** `undefined` — the level leaves the key to the one above (a tracker profile). */
export type RuleChange = [RuleKey, string[] | null | undefined]

/** A list as the draft keeps it: a line a name, blank for none, for "by the categories" and for a key left unset. */
export const ruleText = (value: readonly string[] | null | undefined) => (value ?? []).join('\n')

function OriginCell({ origin, level, profileName, onReset, name }: { origin: RuleOrigin; level: RuleLevel; profileName: string | null; onReset: () => void; name: string }) {
  const text = origin === 'profile' ? t.settings.originProfile(profileName ?? '—') : t.settings.origin[origin]
  return (
    <td className="rule-table__origin">
      <div className="rule-table__origin-line">
        <span className="rule-table__from">{text}</span>
        {origin === level && (
          <button type="button" className="rule-table__reset" title={t.settings.ruleReset(name)} aria-label={t.settings.ruleReset(name)} onClick={onReset}>
            <UndoIcon />
          </button>
        )}
      </div>
    </td>
  )
}

/** The chain rules of one level: a status has one place, a label one rule (BTN-334). The milestones are `MilestoneFields`. */
export function RuleForm(props: RuleFormProps) {
  const { rules, inherited, onEdit, hint = t.settings.rulesHint } = props
  // Only the keys whose value changes: a key a level holds equal to the inherited one stays as it is.
  const put = (next: Partial<ChainRules>, explicit: Partial<ChainRules> = {}) => {
    const inherits = props.level === 'profile'
    const changes = (Object.keys(next) as RuleKey[]).flatMap((key): RuleChange[] => {
      const value = next[key] as string[] | null
      if (JSON.stringify(value) === JSON.stringify(rules[key])) return []
      return [[key, settled(value, inherited[key], (explicit[key] as string[] | undefined) ?? value ?? [], inherits)]]
    })
    if (changes.length > 0) onEdit(changes)
  }
  return (
    <Section title={t.settings.rules} hint={hint}>
      <StatusTable {...props} put={put} />
      <LabelTable {...props} put={put} />
    </Section>
  )
}

type Put = (next: Partial<ChainRules>, explicit?: Partial<ChainRules>) => void

function StatusTable({ rules, inherited, origins, level, profileName, statuses, marks, errorOf, put }: RuleFormProps & { put: Put }) {
  const id = useId()
  const rows = statusRows(statuses, rules, inherited, origins)
  const move = (row: StatusRow, place: StatusPlace) => put(withPlace(rows, row.name, place), withPlace(rows, row.name, place, true))
  return (
    <div className={marks.box(['active', 'terminal'])}>
      <FieldHead label={t.settings.ruleStatuses} hint={t.settings.ruleStatusesHint} />
      {rows.length === 0 ? (
        <p className="settings__hint">{t.settings.ruleNoStatuses}</p>
      ) : (
        <table className="rule-table" aria-label={t.settings.ruleStatuses}>
          <thead>
            <tr>
              <th scope="col">{t.settings.ruleStatus}</th>
              {PLACES.map((place) => (
                <th key={place} scope="col" className="rule-table__pick">
                  {t.settings.place[place]}
                </th>
              ))}
              <th scope="col">{t.settings.ruleFrom}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className={row.origin === level ? undefined : 'rule-table__inherited'}>
                <th scope="row" className="rule-table__name">
                  {row.name}
                </th>
                {PLACES.map((place) => (
                  <td key={place} className="rule-table__pick">
                    <input
                      type="radio"
                      name={`${id}-${row.name}`}
                      aria-label={`${row.name}: ${t.settings.place[place]}`}
                      checked={row.place === place}
                      onChange={() => move(row, place)}
                    />
                  </td>
                ))}
                <OriginCell origin={row.origin} level={level} profileName={profileName} name={row.name} onReset={() => move(row, row.inherited)} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {marks.note('active')}
      {marks.note('terminal')}
      <FieldNote error={errorOf('chain.active')} />
      <FieldNote error={errorOf('chain.terminal')} />
    </div>
  )
}

const ruleOf = (rules: Pick<ChainRules, 'requiredLabels' | 'excludedLabels'>, name: string): 'required' | 'excluded' | null =>
  rules.requiredLabels.some((each) => sameName(each, name)) ? 'required' : rules.excludedLabels.some((each) => sameName(each, name)) ? 'excluded' : null

function LabelTable({ rules, inherited, origins, level, profileName, labels, modelLabels, marks, errorOf, put }: RuleFormProps & { put: Put }) {
  const id = useId()
  const [adding, setAdding] = useState('')
  const [rule, setRule] = useState<'required' | 'excluded'>('excluded')
  const rows = labelRows(rules, origins, labels, modelLabels)
  const set = (name: string, to: 'required' | 'excluded' | null) => put(withLabel(rules, name, to))
  const canAdd = adding.trim() !== '' && !rows.some((row) => sameName(row.name, adding))
  const add = () => {
    if (!canAdd) return
    set(adding.trim(), rule)
    setAdding('')
  }
  const options = [
    { value: 'required', label: t.settings.labelRule.required },
    { value: 'excluded', label: t.settings.labelRule.excluded },
  ]
  const anyLabel = rules.requiredLabels.length === 0
  return (
    <div className={marks.box(['requiredLabels', 'excludedLabels'])}>
      <FieldHead label={t.settings.ruleLabels} hint={t.settings.ruleLabelsHint} />
      <datalist id={`${id}-labels`}>
        {labels
          .filter((name) => !rows.some((row) => sameName(row.name, name)))
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
      <table className="rule-table" aria-label={t.settings.ruleLabels}>
        <thead>
          <tr>
            <th scope="col">{t.settings.ruleLabel}</th>
            <th scope="col">{t.settings.ruleRule}</th>
            <th scope="col">{t.settings.ruleFrom}</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row: LabelRow) => (
            <tr key={`${row.rule}-${row.name}`} className={row.origin === level ? undefined : 'rule-table__inherited'}>
              <th scope="row" className="rule-table__name">
                {row.name}
              </th>
              <td>
                {row.rule === 'required' || row.rule === 'excluded' ? (
                  <Select className="rows__input rule-table__select" label={`${row.name}: ${t.settings.ruleRule}`} value={row.rule} options={options} onChange={(value) => set(row.name, value as 'required' | 'excluded')} />
                ) : (
                  <span className="rule-table__fixed">{t.settings.labelRule[row.rule]}</span>
                )}
              </td>
              <OriginCell origin={row.origin} level={level} profileName={profileName} name={row.name} onReset={() => set(row.name, ruleOf(inherited, row.name))} />
              <td className="rows__action">
                {row.origin !== 'builtin' && (
                  <button type="button" className="rows__button" title={t.settings.remove(row.name)} aria-label={t.settings.remove(row.name)} onClick={() => set(row.name, null)}>
                    <TrashIcon />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="rows__new">
            <td>
              <input
                className="rows__input"
                aria-label={t.settings.labelAdd}
                list={`${id}-labels`}
                spellCheck={false}
                value={adding}
                placeholder={t.settings.labelAdd}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  // Enter would submit the form, and with it the save.
                  event.preventDefault()
                  add()
                }}
                onChange={(event) => setAdding(event.target.value)}
              />
            </td>
            <td>
              <Select className="rows__input rule-table__select" label={t.settings.ruleRule} value={rule} options={options} onChange={(value) => setRule(value as 'required' | 'excluded')} />
            </td>
            <td />
            <td className="rows__action">
              <button type="button" className="rows__button rows__button--add" title={t.settings.add} aria-label={t.settings.add} disabled={!canAdd} onClick={add}>
                <PlusIcon />
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="rule-take" role="radiogroup" aria-label={t.settings.labelTakeTitle}>
        <label className="settings__check">
          <input type="radio" name={`${id}-take`} checked={anyLabel} onChange={() => put({ requiredLabels: [] })} />
          {t.settings.labelTake.any}
        </label>
        <label className="settings__check">
          <input type="radio" name={`${id}-take`} checked={!anyLabel} disabled={anyLabel} onChange={() => {}} />
          {t.settings.labelTake.required}
        </label>
        <HelpTip text={t.settings.labelTakeHint} />
      </div>
      {marks.note('requiredLabels')}
      {marks.note('excludedLabels')}
      <FieldNote error={errorOf('chain.requiredLabels')} />
      <FieldNote error={errorOf('chain.excludedLabels')} />
    </div>
  )
}

export interface MilestoneFieldsProps {
  level: 'shared' | 'project'
  rules: ChainRules
  inherited: ChainRules
  origins: Record<keyof ChainRules, RuleLevel>
  milestones: readonly string[]
  /** A list as the draft keeps it, a line a milestone: a row being typed stays. */
  text: (key: MilestoneKey) => string
  /** The texts one edit changes, together: a pick of the mode may clear both lists. */
  onEdit: (changes: [MilestoneKey, string][]) => void
  errorOf: (field: string) => Notice | null
  marks: Marks
}

type MilestoneKey = 'requiredMilestones' | 'excludedMilestones'

/**
 * Which tasks of the tracker project are the project's (BTN-334): not a rule of the chain — a task left out is not the
 * project's at all. Kept as `requiredMilestones` and `excludedMilestones`.
 */
export function MilestoneFields({ level, rules, inherited, origins, milestones, text, onEdit, errorOf, marks }: MilestoneFieldsProps) {
  const id = useId()
  // "Only" with no milestone yet is "all" in the lists: the pick stays until one is added.
  const [picked, setPicked] = useState<MilestoneMode | null>(null)
  const stored = milestoneModeOf(rules)
  const mode = picked !== null && (stored === 'all' || stored === picked) ? picked : stored
  const own = level === 'project' && (origins.requiredMilestones === 'project' || origins.excludedMilestones === 'project')
  const put = (next: Pick<ChainRules, MilestoneKey>) => {
    const keys = (['requiredMilestones', 'excludedMilestones'] as const).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(rules[key]))
    if (keys.length > 0) onEdit(keys.map((key) => [key, ruleText(next[key])]))
  }
  const pick = (next: MilestoneMode) => {
    setPicked(next)
    put(withMilestoneMode(rules, next))
  }
  const list = (key: MilestoneKey, other: MilestoneKey) => (
    <ListTable
      label={t.settings.rule[key]}
      value={text(key)}
      add={t.settings.ruleAdd[key]}
      empty={t.settings.milestonesEmpty}
      suggest={withoutListed(milestones, text(other))}
      onChange={(value) => onEdit([[key, value]])}
    />
  )
  return (
    <div className={marks.box(['requiredMilestones', 'excludedMilestones'])}>
      {level === 'project' && <FieldHead label={t.settings.milestones} hint={t.settings.milestonesHint} />}
      <div className={own || level === 'shared' ? 'rule-take' : 'rule-take rule-table__inherited'} role="radiogroup" aria-label={t.settings.milestones}>
        {MODES.map((each) => (
          <label key={each} className="settings__check">
            <input type="radio" name={`${id}-mode`} checked={mode === each} onChange={() => pick(each)} />
            {t.settings.milestoneMode[each]}
          </label>
        ))}
        {level === 'project' && (
          <span className="rule-table__origin-line">
            <span className="rule-table__from">{own ? t.settings.origin.project : t.settings.origin.shared}</span>
            {own && (
              <button
                type="button"
                className="rule-table__reset"
                title={t.settings.ruleReset(t.settings.milestones)}
                aria-label={t.settings.ruleReset(t.settings.milestones)}
                onClick={() => {
                  setPicked(null)
                  put(inherited)
                }}
              >
                <UndoIcon />
              </button>
            )}
          </span>
        )}
      </div>
      {mode === 'only' && list('requiredMilestones', 'excludedMilestones')}
      {(mode === 'except' || rules.excludedMilestones.length > 0) && (
        <>
          {mode === 'only' && <span className="settings__hint">{t.settings.milestonesBut}</span>}
          {list('excludedMilestones', 'requiredMilestones')}
        </>
      )}
      {marks.note('requiredMilestones')}
      {marks.note('excludedMilestones')}
      <FieldNote error={errorOf('chain.requiredMilestones')} />
      <FieldNote error={errorOf('chain.excludedMilestones')} />
    </div>
  )
}
