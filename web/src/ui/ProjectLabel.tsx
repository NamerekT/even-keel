import { useLive } from '../live/context.js'
import { projectName } from '../state.js'

/** A project as the page names it: its key and, when the config gives one, its name after it. */
export function ProjectLabel({ project, nameClass = 'project-name' }: { project: string; nameClass?: string }) {
  const { state } = useLive()
  const name = state === null ? null : projectName(state, project)
  return (
    <>
      {project}
      {name !== null && <span className={nameClass}>{name}</span>}
    </>
  )
}
