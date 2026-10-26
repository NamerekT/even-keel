import { useId, type ReactNode } from 'react'
import { DEFAULT_EXCEPT, INTERFACE_FILES } from '../../../src/projects/standards.js'
import { t } from '../i18n/index.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { TrashIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { rowsText, standardRows, type StandardRow } from './projectForm.js'
import { FieldHead, HelpTip, Switch } from './settingsParts.js'
import './standards.css'

/** The design document a screen standard is likely to name, when the branch has it. */
const DESIGN_DOC = 'docs/design.md'

/**
 * The project's standards (BTN-359): a box per document with its masks, its exceptions and the merge's check, the
 * documents picked from the Markdown files of the project's branch. `value` is the rows as JSON (`standardRows`).
 */
export function ProjectStandards({
  project,
  branch,
  trim,
  value,
  onChange,
  className,
  children,
}: {
  project: string
  branch: string
  trim: boolean
  value: string
  onChange: (value: string) => void
  className: string
  /** The marks of a change and the error, under the list. */
  children: ReactNode
}) {
  const text = t.settings.standards
  const loaded = useToolsViews([project], trim).get(project)
  const docs = loaded?.state === 'ready' ? (loaded.view?.docs ?? null) : null
  const rows = standardRows(value)
  const set = (next: StandardRow[]) => onChange(rowsText(next))
  const change = (index: number, patch: Partial<StandardRow>) => set(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  const unused = (docs ?? []).filter((doc) => !rows.some((row) => row.doc === doc))
  const add = (row: Omit<StandardRow, 'doc'>, prefer?: string) =>
    set([...rows, { doc: prefer !== undefined && unused.includes(prefer) ? prefer : (unused[0] ?? ''), ...row }])
  const except = DEFAULT_EXCEPT.join(', ')

  return (
    <div className={`${className} standards`}>
      {rows.length === 0 && <p className="settings__hint">{text.empty}</p>}
      {rows.map((row, index) => (
        <Standard
          key={index}
          row={row}
          docs={docs}
          taken={rows.filter((_, at) => at !== index).map((each) => each.doc)}
          branch={branch}
          onChange={(patch) => change(index, patch)}
          onRemove={() => set(rows.filter((_, at) => at !== index))}
        />
      ))}
      <div className="settings__line-extra">
        <Tipped tip={text.presetHint} inline>
          <button type="button" className="button button--small" onClick={() => add({ files: INTERFACE_FILES.join(', '), except, shots: true }, DESIGN_DOC)}>
            {text.preset}
          </button>
        </Tipped>
        <button type="button" className="button button--small" onClick={() => add({ files: '', except, shots: false })}>
          {text.add}
        </button>
      </div>
      {children}
    </div>
  )
}

function Standard({
  row,
  docs,
  taken,
  branch,
  onChange,
  onRemove,
}: {
  row: StandardRow
  docs: string[] | null
  taken: string[]
  branch: string
  onChange: (patch: Partial<StandardRow>) => void
  onRemove: () => void
}) {
  const text = t.settings.standards
  const id = useId()
  // A document the branch does not hold stays on offer, so the box shows what is set; `null` — the branch is not read yet.
  const gone = docs !== null && row.doc !== '' && !docs.includes(row.doc)
  const options = [
    ...(row.doc === '' ? [{ value: '', label: text.docPick }] : []),
    ...[...(docs ?? []), ...(gone || docs === null ? [row.doc] : [])].filter((doc) => doc !== '' && !taken.includes(doc)).map((doc) => ({ value: doc, label: doc })),
  ]
  // The masks wrap: the preset's list does not fit one line of the panel.
  const field = (key: 'files' | 'except', label: string, hint: string) => (
    <div className="standard__field settings__help-scope">
      <FieldHead label={label} hint={hint} htmlFor={`${id}-${key}`} />
      <textarea
        id={`${id}-${key}`}
        className="settings__text settings__text--mono standard__masks"
        rows={1}
        spellCheck={false}
        value={row[key]}
        aria-invalid={key === 'files' && row.files.trim() === ''}
        onChange={(event) => onChange({ [key]: event.target.value })}
      />
    </div>
  )
  const remove = text.removeOf(row.doc || text.docPick)

  return (
    <div className="standard">
      <div className="standard__field settings__help-scope">
        <FieldHead label={text.doc} hint={text.docHint} htmlFor={`${id}-doc`} />
        <div className="standard__doc">
          <Select
            id={`${id}-doc`}
            className="settings__text settings__text--mono"
            value={row.doc}
            options={options}
            invalid={row.doc === '' || gone}
            search={{ placeholder: text.docSearch, none: text.docNone }}
            onChange={(doc) => onChange({ doc })}
          />
          <Tipped tip={remove} inline>
            <button type="button" className="rows__button" aria-label={remove} onClick={onRemove}>
              <TrashIcon />
            </button>
          </Tipped>
        </div>
      </div>
      {gone && <p className="notice notice--warn standard__gone">{text.docGone(branch)}</p>}
      {field('files', text.files, text.filesHint)}
      {field('except', text.except, text.exceptHint)}
      <div className="standard__foot settings__help-scope">
        <span className="settings__head-row">
          <label className="settings__label" htmlFor={`${id}-shots`}>
            {text.shots}
          </label>
          <HelpTip text={text.shotsHint} />
        </span>
        <Switch id={`${id}-shots`} checked={row.shots} onChange={(shots) => onChange({ shots })} />
      </div>
    </div>
  )
}
