import { TrackerNotFound } from '../tracker/source.js'
import type { GitlabApi } from './api.js'
import type { GitlabHierarchy } from './hierarchy.js'
import { EMPTY_HIERARCHY, type GitlabLink, type GitlabRef, type Hierarchy } from './model.js'

interface Page { hasNextPage: boolean; endCursor: string | null }
interface Item { iid: string; title: string; state: string; webUrl: string }
interface Widget {
  parent?: Item | null
  children?: { nodes: Item[]; pageInfo: Page }
  linkedItems?: { nodes: { linkType: string; workItem: Item }[]; pageInfo: Page }
}
interface Answer {
  data?: { project: { workItems: { nodes: { iid: string; widgets: Widget[] }[]; pageInfo: Page } } | null }
  errors?: { message: string; extensions?: { code?: string } }[]
}
interface Relations { hierarchy: Hierarchy; links: GitlabLink[] }

const refOf = (item: Item): GitlabRef => ({ iid: Number(item.iid), title: item.title, state: item.state.toLowerCase() === 'closed' ? 'closed' : 'opened', web_url: item.webUrl })
const fields = 'iid title state webUrl'
const query = (links: boolean) => `query($path: ID!, $iids: [String!]!, $after: String) {
  project(fullPath: $path) { workItems(iids: $iids, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { iid widgets {
      ... on WorkItemWidgetHierarchy {
        parent { ${fields} }
        children(first: 100) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }
      }
      ${links ? `... on WorkItemWidgetLinkedItems {
        linkedItems(first: 100) { nodes { linkType workItem { ${fields} } } pageInfo { hasNextPage endCursor } }
      }` : ''}
    } }
  } }
}`

/** A read owns its results; no relations are cached across polls. */
export class GitlabBatch {
  private mode: 'all' | 'hierarchy' | 'rest' = 'all'

  constructor(private readonly api: GitlabApi, private readonly hierarchy: GitlabHierarchy,
    private readonly linksOf: (path: string, iid: number) => Promise<GitlabLink[]>) {}

  async read(path: string, iids: number[]): Promise<Map<number, Relations>> {
    const results = new Map<number, Relations>()
    for (let offset = 0; offset < iids.length; offset += 20) {
      const chunk = iids.slice(offset, offset + 20)
      const widgets = await this.widgets(path, chunk)
      const rows = await limitedMap(chunk, async (iid) => {
        const parts = widgets.get(iid) ?? []
        const tree = parts.find((part) => part.children !== undefined)
        const linked = parts.find((part) => part.linkedItems !== undefined)?.linkedItems
        const hierarchy = tree?.children?.pageInfo.hasNextPage ? await this.hierarchy.read(path, iid)
          : tree === undefined ? EMPTY_HIERARCHY : { parent: tree.parent == null ? null : refOf(tree.parent), children: tree.children!.nodes.map(refOf) }
        const links = linked === undefined || linked.pageInfo.hasNextPage ? await this.linksOf(path, iid)
          : linked.nodes.map(({ linkType, workItem }): GitlabLink => {
            const kind = linkType.toLowerCase()
            if (!['blocks', 'is_blocked_by', 'relates_to', 'related'].includes(kind)) throw new Error(`gitlab: unknown link type ${linkType}`)
            return { ...refOf(workItem), link_type: kind === 'related' ? 'relates_to' : kind as GitlabLink['link_type'] }
          })
        return [iid, { hierarchy, links }] as const
      })
      for (const [iid, relations] of rows) results.set(iid, relations)
    }
    return results
  }

  private async widgets(path: string, iids: number[]): Promise<Map<number, Widget[]>> {
    const result = new Map<number, Widget[]>()
    if (this.mode === 'rest') return result
    let after: string | null = null
    const seen = new Set<string>()
    do {
      let answer: Answer
      try {
        answer = await (await this.api.request('/api/graphql', 'POST', { query: query(this.mode === 'all'), variables: { path, iids: iids.map(String), after } })).json() as Answer
      } catch (error) {
        if (!(error instanceof TrackerNotFound)) throw error
        this.mode = 'rest'
        return result
      }
      if (answer.errors?.length) {
        if (!answer.errors.every((error) => ['undefinedField', 'undefinedType', 'argumentNotAccepted'].includes(error.extensions?.code ?? ''))) {
          throw new Error(`gitlab: relations: ${answer.errors.map((error) => error.message).join('; ')}`)
        }
        this.mode = this.mode === 'all' ? 'hierarchy' : 'rest'
        return this.widgets(path, iids)
      }
      if (answer.data?.project == null) throw new TrackerNotFound(`gitlab: project ${path} not found`)
      const items = answer.data.project.workItems
      for (const item of items.nodes) result.set(Number(item.iid), item.widgets)
      after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null
      if (items.pageInfo.hasNextPage && (after === null || seen.has(after))) throw new Error('gitlab: invalid work item pagination')
      if (after !== null) seen.add(after)
    } while (after !== null)
    return result
  }
}

export async function limitedMap<T, R>(items: readonly T[], convert: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length)
  let index = 0
  let failed = false
  const workers = Array.from({ length: Math.min(6, items.length) }, async () => {
    while (!failed && index < items.length) {
      const next = index++
      try { result[next] = await convert(items[next]!) } catch (error) { failed = true; throw error }
    }
  })
  const settled = await Promise.allSettled(workers)
  const failure = settled.find((each) => each.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return result
}
