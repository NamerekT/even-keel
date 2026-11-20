import { BUILTIN } from '../../../src/builtin/model.js'
import type { EvenKeelState, ProjectDraft } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { Card, Fact, FactList } from '../ui/blocks.js'
import { TrackerIcon } from '../ui/icons.js'
import { MachineLabel } from '../ui/MachineLabel.js'
import { taskExample, trackerPlace, type TrackerShape, type WizardFields } from './projectWizard.js'
import type { MachinesBlockProps } from './WizardMachines.js'
import { hubOn, machineFolder, pickedMachines } from './machinePicks.js'

interface SummaryProps {
  state: EvenKeelState
  fields: WizardFields
  shape: TrackerShape
  draft: ProjectDraft | undefined
  /** The top of the repository the check found; `null` — none yet. */
  root: string | null
  /** The checkout's branch, the main branch's default. */
  current: string | null
  /** The block "Machines" of the repository step; `null` — hidden, the hub's folder alone. */
  block: SummaryBlock | null
}

type SummaryBlock = Pick<MachinesBlockProps, 'machines' | 'remote' | 'hubName'>

/**
 * "What will be created" (BTN-344): the project as it will be added, from the fields as they are typed. A card of its
 * own, apart from the steps and the button, so that it goes whole if it turns out to say nothing new.
 */
export function ProjectSummary({ state, fields, shape, draft, root, current, block }: SummaryProps) {
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
          <NameValue name={name} projectKey={key} />
        </Fact>
        <Fact label={t.wizard.summary.tracker}>
          <TrackerValue kind={fields.profile === '' && !own ? null : fields.tracker} tracker={tracker} place={place} />
        </Fact>
        {fields.git && (
          <Fact label={t.wizard.summary.branch}>
            <Value text={fields.branch.trim() || current || ''} mono />
          </Fact>
        )}
        {block === null ? (
          <Fact label={t.wizard.summary.folder} wide>
            <Value text={!fields.git && fields.repo.trim() === '' && root !== null ? t.wizard.folderOwn(root) : (root ?? fields.repo.trim())} mono={fields.git || fields.repo.trim() !== ''} />
          </Fact>
        ) : (
          <Fact label={t.wizard.summary.machines} wide>
            <MachineFolders fields={fields} block={block} root={root} />
          </Fact>
        )}
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

/** Each ticked machine with its label and the folder's full path there (BTN-1297); a dash while a path is not known yet. */
function MachineFolders({ fields, block, root }: { fields: WizardFields; block: SummaryBlock; root: string | null }) {
  const { machines, remote, hubName } = block
  const hub = machines.find((machine) => machine.own)
  const rows = [
    ...(hub !== undefined && hubOn(fields, remote) ? [{ machine: hub, path: root ?? '' }] : []),
    ...pickedMachines(fields, machines, remote).map((machine) => ({ machine, path: machineFolder(fields.machines[machine.id]!, machine, hubName) ?? '' })),
  ]
  if (rows.length === 0) return <dd className="project-summary__none">—</dd>
  return (
    <dd className="project-summary__machines">
      {rows.map(({ machine, path }) => (
        <span key={machine.id} className="project-summary__machine">
          <MachineLabel id={machine.id} name={machine.name} color={machine.color} />
          <span className={path === '' ? 'project-summary__none' : 'project-summary__mono'}>{path || '—'}</span>
        </span>
      ))}
    </dd>
  )
}

/** The project's name with its key as a tag beside it (BTN-1382); the key alone when it is the name too. */
export function NameValue({ name, projectKey }: { name: string; projectKey: string }) {
  if (name === '') return <Value text="" />
  return (
    <dd className="project-summary__name">
      {name}
      {projectKey !== '' && projectKey !== name && <span className="tag">{projectKey}</span>}
    </dd>
  )
}

/** The tracker by its icon and the place in it (BTN-1382), its name where there is no place; `kind` `null` — none picked yet. */
export function TrackerValue({ kind, tracker, place }: { kind: string | null; tracker: string; place: string }) {
  if (kind === null || (place === '' && tracker === '')) return <Value text="" />
  return (
    <dd className="project-summary__name">
      <TrackerIcon kind={kind} />
      {place === '' ? tracker : place}
    </dd>
  )
}

/** A fact's value; a dash while the field is blank. */
function Value({ text, mono = false }: { text: string; mono?: boolean }) {
  if (text === '') return <dd className="project-summary__none">—</dd>
  return <dd className={mono ? 'project-summary__mono' : undefined}>{text}</dd>
}
