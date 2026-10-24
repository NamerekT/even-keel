import type { EvenKeelState, ProjectDraft } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { Card, Fact, FactList } from '../ui/blocks.js'
import { taskExample, trackerPlace, type TrackerShape, type WizardFields } from './projectWizard.js'

interface SummaryProps {
  state: EvenKeelState
  fields: WizardFields
  shape: TrackerShape
  draft: ProjectDraft | undefined
  /** The top of the repository the check found; `null` — none yet. */
  root: string | null
  /** The checkout's branch, the main branch's default. */
  current: string | null
}

/**
 * "What will be created" (BTN-344): the project as it will be added, from the fields as they are typed. A card of its
 * own, apart from the steps and the button, so that it goes whole if it turns out to say nothing new.
 */
export function ProjectSummary({ state, fields, shape, draft, root, current }: SummaryProps) {
  const key = fields.key.trim()
  const name = fields.name.trim() || key
  const tracker = state.config.trackers.find((each) => each.name === fields.tracker)?.title ?? ''
  const place = trackerPlace(shape, fields)
  return (
    <Card title={t.wizard.summary.title} className="project-summary">
      <FactList className="project-summary__facts">
        <Fact label={t.wizard.summary.project}>
          <Value text={name === '' ? '' : key === '' || name === key ? name : `${name} · ${key}`} />
        </Fact>
        <Fact label={t.wizard.summary.tracker}>
          <Value text={fields.profile === '' ? '' : place === '' ? tracker : `${tracker} · ${place}`} />
        </Fact>
        <Fact label={t.wizard.summary.branch}>
          <Value text={fields.branch.trim() || current || ''} mono />
        </Fact>
        <Fact label={t.wizard.summary.folder} wide>
          <Value text={root ?? fields.repo.trim()} mono />
        </Fact>
        <Fact label={t.wizard.summary.tasks} className="project-summary__wide">
          <Value text={taskExample(shape, fields) ?? ''} mono />
        </Fact>
        <Fact label={t.wizard.summary.places}>
          <Value text={draft === undefined ? '' : t.wizard.placeNow(draft.slot)} />
        </Fact>
      </FactList>
    </Card>
  )
}

/** A fact's value; a dash while the field is blank. */
function Value({ text, mono = false }: { text: string; mono?: boolean }) {
  if (text === '') return <dd className="project-summary__none">—</dd>
  return <dd className={mono ? 'project-summary__mono' : undefined}>{text}</dd>
}
