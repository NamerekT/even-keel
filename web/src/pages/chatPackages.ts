import type { PackagesView } from '../../../src/state.js'
import { projectGroups, shortName, type PackageGroup } from '../tools/packageGroups.js'

/** A chat's own choice of packages over the project's set (BTN-1696): absent — as the level above has it. */
export type OwnPackages = Record<string, boolean>

export type OwnChoice = 'inherit' | 'on' | 'off'

/** Where a package's value comes from: the catalog's default, the project, the chat; the built-in one is always on. */
export type PackageSource = 'evenKeel' | 'project' | 'chat' | 'builtIn'

export interface ChatPackageRow {
  name: string
  label: string
  builtIn: boolean
  own: OwnChoice
  /** What the chat's session gets. */
  enabled: boolean
  source: PackageSource
  /** What it would get without the chat's own value. */
  above: { enabled: boolean; source: Exclude<PackageSource, 'chat'> }
}

export interface ChatPackageGroup extends Pick<PackageGroup, 'kind' | 'marketplace'> {
  rows: ChatPackageRow[]
}

/** The project's packages by group as a chat sees them: each with the chat's own value, the outcome and its source. */
export function chatPackageGroups(view: PackagesView, project: string, own: OwnPackages): ChatPackageGroup[] {
  const cells = view.projects[project]?.cells ?? {}
  return projectGroups(view, project).map((group) => ({
    kind: group.kind,
    marketplace: group.marketplace,
    rows: [...group.packages, ...group.folded].map((pkg): ChatPackageRow => {
      const found = cells[pkg.name]
      const above = pkg.builtIn
        ? { enabled: true, source: 'builtIn' as const }
        : { enabled: found?.enabled === true, source: found?.choice === null || found?.choice === undefined ? ('evenKeel' as const) : ('project' as const) }
      const value = pkg.builtIn ? undefined : own[pkg.name]
      return {
        name: pkg.name,
        label: shortName(pkg),
        builtIn: pkg.builtIn,
        own: value === undefined ? 'inherit' : value ? 'on' : 'off',
        enabled: value ?? above.enabled,
        source: value === undefined ? above.source : 'chat',
        above,
      }
    }),
  }))
}

/** The chat's own values of packages the project no longer has: out of the catalog or removed. The session gets none. */
export function goneChoices(view: PackagesView, project: string, own: OwnPackages): { name: string; on: boolean }[] {
  const cells = view.projects[project]?.cells ?? {}
  const live = new Set(view.packages.filter((each) => !each.removed && cells[each.name] !== undefined).map((each) => each.name))
  return Object.entries(own)
    .filter(([name]) => !live.has(name))
    .map(([name, on]) => ({ name, on }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function withChoice(own: OwnPackages, name: string, choice: OwnChoice): OwnPackages {
  const { [name]: _dropped, ...rest } = own
  return choice === 'inherit' ? rest : { ...rest, [name]: choice === 'on' }
}

export const ownCount = (own: OwnPackages): number => Object.keys(own).length
