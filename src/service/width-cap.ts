import { fail } from '../notice/notice.js'

/**
 * A project's width (`docs/settings.md`) is at most its machines (BTN-1571): every machine of its list "The project's
 * machines", turned on or off, the own one too; a project with none named has the own machine alone, so 1.
 */
export interface WidthFitDeps {
  widthOf(project: string): number
  /** `undefined` — the machines are not read yet, nothing to fit to. */
  capOf(project: string): number | undefined
  save(project: string, width: number): void
  label(project: string): string
  log(line: string): void
}

/** Cuts each width above its project's machines, a machine gone from the list; a width is never raised. */
export function fitWidths(projects: readonly string[], deps: WidthFitDeps): void {
  for (const project of projects) {
    const cap = deps.capOf(project)
    const width = deps.widthOf(project)
    if (cap === undefined || width <= cap) continue
    try {
      deps.save(project, cap)
      deps.log(`config: project ${deps.label(project)} runs ${cap} task(s) at once, not ${width}: it has ${cap} machine(s) now`)
    } catch (error) {
      deps.log(`config: the width of project ${deps.label(project)} was not cut to ${cap}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** The page's save of a new width above the project's machines is refused; one left as it was is the fit's to cut. */
export function checkWidth(width: number, base: number, cap: number | undefined): void {
  if (cap !== undefined && width !== base && width > cap) throw fail('config.widthOverMachines', { max: cap })
}
