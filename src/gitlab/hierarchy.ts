import { TrackerNotFound } from '../tracker/source.js'
import type { GitlabApi } from './api.js'
import { EMPTY_HIERARCHY, type GitlabRef, type Hierarchy } from './model.js'

interface WorkItem { iid: string; title: string; state: string; webUrl: string }
interface Widget {
  parent?: WorkItem | null
  children?: { nodes: WorkItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
}
interface Answer {
  data?: { project: { workItems: { nodes: { widgets: Widget[] }[] } } | null }
  errors?: { message: string; extensions?: { code?: string } }[]
}

const QUERY = `query($path: ID!, $iid: String!, $after: String) {
  project(fullPath: $path) { workItems(iids: [$iid], first: 1) { nodes { widgets {
    ... on WorkItemWidgetHierarchy {
      parent { iid title state webUrl }
      children(first: 100, after: $after) { nodes { iid title state webUrl } pageInfo { hasNextPage endCursor } }
    }
  } } } }
}`

const refOf = (item: WorkItem): GitlabRef => ({ iid: Number(item.iid), title: item.title, state: item.state.toLowerCase() === 'closed' ? 'closed' : 'opened', web_url: item.webUrl })

/** Work item hierarchies are on Free too; older schemas or a missing widget leave this capability empty. */
export class GitlabHierarchy {
  private supported = true
  constructor(private readonly api: GitlabApi) {}

  async read(path: string, iid: number): Promise<Hierarchy> {
    if (!this.supported) return EMPTY_HIERARCHY
    const result: Hierarchy = { parent: null, children: [] }
    let after: string | null = null
    const seen = new Set<string>()
    do {
      let answer: Answer
      try {
        answer = await (await this.api.request('/api/graphql', 'POST', { query: QUERY, variables: { path, iid: String(iid), after } })).json() as Answer
      } catch (error) {
        if (!(error instanceof TrackerNotFound)) throw error
        this.supported = false
        return EMPTY_HIERARCHY
      }
      if (answer.errors?.length) {
        const unavailable = answer.errors.every((error) => ['undefinedField', 'undefinedType', 'argumentNotAccepted'].includes(error.extensions?.code ?? ''))
        if (!unavailable) throw new Error(`gitlab: hierarchy: ${answer.errors.map((error) => error.message).join('; ')}`)
        this.supported = false
        return EMPTY_HIERARCHY
      }
      if (answer.data?.project == null) throw new TrackerNotFound(`gitlab: project ${path} not found`)
      const widget = answer.data.project.workItems.nodes[0]?.widgets.find((each) => each.children !== undefined)
      if (widget === undefined) return EMPTY_HIERARCHY
      result.parent = widget.parent == null ? null : refOf(widget.parent)
      result.children.push(...widget.children!.nodes.map(refOf))
      const page = widget.children!.pageInfo
      after = page.hasNextPage ? page.endCursor : null
      if (page.hasNextPage && (after === null || seen.has(after))) throw new Error('gitlab: invalid hierarchy pagination')
      if (after !== null) seen.add(after)
    } while (after !== null)
    return result
  }
}
