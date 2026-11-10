import { BUILTIN } from '../../../src/builtin/model.js'
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
  const own = fields.tracker === BUILTIN
  const tracker = own ? t.system.builtin : (state.config.trackers.find((each) => each.name === fields.tracker)?.title ?? '')
  // The built-in tracker has no place of its own: the key already names the project.
  const place = own ? '' : trackerPlace(shape, fields)
  return (
    <Card title={t.wizard.summary.title} className="project-summary">
      <FactList className="project-summary__facts">
        <Fact label={t.wizard.summary.project}>
          <Value text={name === '' ? '' : key === '' || name === key ? name : `${name} · ${key}`} />
        </Fact>
        <Fact label={t.wizard.summary.tracker}>
          <Value text={fields.profile === '' && !own ? '' : place === '' ? tracker : `${tracker} · ${place}`} />
        </Fact>
        {fields.git && (
          <Fact label={t.wizard.summary.branch}>
            <Value text={fields.branch.trim() || current || ''} mono />
          </Fact>
        )}
        <Fact label={t.wizard.summary.folder} wide>
          <Value text={!fields.git && fields.repo.trim() === '' && root !== null ? t.wizard.folderOwn(root) : (root ?? fields.repo.trim())} mono={fields.git || fields.repo.trim() !== ''} />
        </Fact>
        <Fact label={fields.git ? t.wizard.summary.tasks : t.wizard.summary.task} className="project-summary__wide">
          <Value text={taskExample(shape, fields) ?? ''} mono />
        </Fact>
        <Fact label={t.wizard.summary.places}>
          <Value text={!fields.git ? t.wizard.placePlainNow : draft === undefined ? '' : t.wizard.placeNow(draft.slot)} />
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
