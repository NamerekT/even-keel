import { useState } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState, MachinePage as MachinePageView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ownProjects, projectLabel, projectPath } from '../state.js'
import { Card, EmptyState } from '../ui/blocks.js'
import { CloseIcon } from '../ui/icons.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import './machineMemory.css'

type MemoryFolder = NonNullable<MachinePageView['memory']>[number]

/**
 * "Other projects' memory" of a machine elsewhere (BTN-1648): its folders bound to the memory of projects outside its
 * pool, each with "Unbind", and a project with a folder's path to bind one more. The whole list goes at each change.
 */
export function MachineMemoryCard({ state, page, reload }: { state: EvenKeelState; page: MachinePageView; reload: () => Promise<void> }) {
  const text = t.machinePage
  const { send, sending, failure } = useCommand()
  const projects = ownProjects(state)
  const bound = page.memory ?? []
  const [project, setProject] = useState(projects[0] ?? '')
  const [folder, setFolder] = useState('')
  const fresh = folder.trim() !== '' && projects.includes(project)
  const save = async (folders: MemoryFolder[]) => {
    const done = await send('machines/memory', { machine: page.id, folders })
    if (done) await reload()
    return done
  }
  const add = async () => {
    if (!fresh) return
    if (await save([...bound, { project, folder: folder.trim() }])) setFolder('')
  }
  return (
    <Card
      title={
        <span className="machine-memory__title">
          {text.memory}
          <HelpTip text={text.memoryHint} />
        </span>
      }
      titleId="machine-memory"
    >
      {bound.length === 0 ? (
        <EmptyState>{text.memoryNone}</EmptyState>
      ) : (
        <ul className="machine-page__list">
          {bound.map((each, index) => (
            <li key={`${each.project}\n${each.folder}`} className="machine-page__row row-action-host">
              <span className="machine-page__main">
                <Link to={projectPath(each.project)} className="machine-page__name">
                  <ProjectLabel project={each.project} />
                </Link>
                <Tipped tip={text.folderTip} inline align="start">
                  <bdi className="machine-page__path" dir="ltr">
                    {each.folder}
                  </bdi>
                </Tipped>
              </span>
              <button
                type="button"
                className="row-action"
                aria-label={text.memoryRemove}
                disabled={sending}
                onClick={() => void save(bound.filter((_, at) => at !== index))}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="machine-memory__add"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <Select
          className="settings__text machine-memory__project"
          label={text.memoryProject}
          value={project}
          options={projects.map((id) => ({ value: id, label: projectLabel(state, id) }))}
          onChange={setProject}
          disabled={sending || projects.length === 0}
        />
        <input
          className="settings__text machine-memory__folder"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          aria-label={text.memoryFolder}
          placeholder={text.memoryFolderPlaceholder}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        />
        <button type="submit" className="button button--primary" disabled={sending || !fresh}>
          {text.memoryAdd}
        </button>
      </form>
      {failure !== null && (
        <p role="alert" className="notice notice--error">
          {say(failure)}
        </p>
      )}
    </Card>
  )
}
