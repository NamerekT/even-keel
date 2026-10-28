import { useLive } from '../live/context.js'
import { projectLabel, projectName } from '../state.js'

/** `projectLabel` over the live state, for text that names a project by its id. */
export function useProjectLabel(): (project: string) => string {
  const { state } = useLive()
  return (project) => projectLabel(state, project)
}

/**
 * A project as the page names it: its key and, when the config gives one, its name after it. Without a name, a key
 * another project has comes with what tells the two apart (`projectLabel`).
 */
export function ProjectLabel({ project, nameClass = 'project-name', keyClass }: { project: string; nameClass?: string; keyClass?: string }) {
  const { state } = useLive()
  const name = state === null ? null : projectName(state, project)
  const key = name === null ? projectLabel(state, project) : (state?.projectKeys[project] ?? project)
  return (
    <>
      {keyClass === undefined ? key : <span className={keyClass}>{key}</span>}
      {name !== null && <span className={nameClass}>{name}</span>}
    </>
  )
}
