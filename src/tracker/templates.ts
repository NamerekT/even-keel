import { parseRemote } from '../ci/remote.js'
import type { Git } from '../git/types.js'

/**
 * Issue templates of a branch and the labels they put on (BTN-1130): GitHub, Forgejo and Gitea put a template's labels
 * on an issue of any author, GitLab runs a description template's `/label`. A label the chain or the intake trusts as a
 * person's go must not be among them.
 */
export interface IssueTemplate {
  /** Its path on the branch. */
  path: string
  labels: string[]
}

/** A label the project trusts that an issue template puts on. */
export interface TemplateHit {
  label: string
  /** The template's path on the branch. */
  template: string
}

const FORGE_TEMPLATE = /^\.(github|gitea|forgejo)\/issue_template(\.md|\/[^/]+\.(md|ya?ml))$/i
const GITLAB_TEMPLATE = /^\.gitlab\/issue_templates\/[^/]+\.md$/i
/** The template chooser's settings, no template. */
const CHOOSER = /\/config\.ya?ml$/i

export const isIssueTemplate = (path: string): boolean => (FORGE_TEMPLATE.test(path) && !CHOOSER.test(path)) || GITLAB_TEMPLATE.test(path)

/** The labels a template puts on: the top-level `labels` of a form or of a Markdown front matter; GitLab's `/label`. */
export function templateLabels(path: string, text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (GITLAB_TEMPLATE.test(path)) return lines.flatMap((line) => (/^\/label\s/.test(line) ? quickLabels(line) : []))
  if (/\.md$/i.test(path)) {
    if (lines[0]?.trim() !== '---') return []
    const end = lines.indexOf('---', 1)
    return end < 0 ? [] : yamlLabels(lines.slice(1, end))
  }
  return yamlLabels(lines)
}

function quickLabels(line: string): string[] {
  return [...line.matchAll(/~(?:"([^"]+)"|([^\s~]+))/g)].map((match) => (match[1] ?? match[2]!).trim()).filter((label) => label !== '')
}

/** A YAML document's top-level `labels`: an inline list or string, or a block list under it. */
function yamlLabels(lines: string[]): string[] {
  const start = lines.findIndex((line) => /^labels\s*:/.test(line))
  if (start < 0) return []
  const inline = stripComment(lines[start]!.replace(/^labels\s*:/, '')).trim()
  if (inline !== '') return (/^\[.*\]$/.test(inline) ? inline.slice(1, -1) : inline).split(',').map(unquote).filter((label) => label !== '')
  const labels: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item === null) break
    const label = unquote(stripComment(item[1]!))
    if (label !== '') labels.push(label)
  }
  return labels
}

const stripComment = (value: string): string => value.replace(/\s+#.*$/, '')

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, '$2').trim()

/** The labels of `trusted` the templates put on, one hit a label and template; labels match whatever their case. */
export function templateHits(templates: readonly IssueTemplate[], trusted: readonly string[]): TemplateHit[] {
  const wanted = new Set(trusted.map((label) => label.toLowerCase()))
  return templates.flatMap((template) =>
    [...new Set(template.labels.map((label) => label.toLowerCase()))].filter((label) => wanted.has(label)).map((label) => ({
      label: trusted.find((each) => each.toLowerCase() === label)!,
      template: template.path,
    })),
  )
}

/**
 * Whether one of the folder's remotes is the tracker's repository `place` (`owner/name`, a GitLab path with its groups):
 * only then are the folder's templates that repository's.
 */
export function isOwnRepo(remotes: readonly { url: string }[], place: string): boolean {
  const wanted = place.toLowerCase().replace(/^\/+|\/+$/g, '')
  return remotes.some(({ url }) => {
    const remote = parseRemote(url)
    const slug = remote === null ? null : `${remote.owner}/${remote.repo}`.toLowerCase()
    return slug !== null && (wanted === slug || wanted.endsWith(`/${slug}`))
  })
}

/** Reads a branch's templates again only once it points at another commit: the tracker's reads ask every 30 s. */
export class IssueTemplateReader {
  private readonly last = new Map<string, { commit: string; templates: IssueTemplate[] }>()
  constructor(private readonly git: Git) {}

  async read(repo: string, branch: string): Promise<IssueTemplate[] | null> {
    const head = await this.git(repo, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])
    if (head.code !== 0) return null
    const commit = head.out.trim()
    const key = JSON.stringify([repo, branch])
    const known = this.last.get(key)
    if (known?.commit === commit) return known.templates
    const templates = await readIssueTemplates(this.git, repo, commit)
    if (templates !== null) this.last.set(key, { commit, templates })
    return templates
  }
}

/** The branch's issue templates; `null` — the branch cannot be read. */
export async function readIssueTemplates(git: Git, repo: string, branch: string): Promise<IssueTemplate[] | null> {
  // `ls-tree` takes no glob in its paths: the whole tree, filtered here.
  const tree = await git(repo, ['ls-tree', '-r', '--name-only', branch])
  if (tree.code !== 0) return null
  const paths = tree.out.split('\n').map((line) => line.trim()).filter(isIssueTemplate).sort()
  const templates: IssueTemplate[] = []
  for (const path of paths) {
    const file = await git(repo, ['show', `${branch}:${path}`])
    if (file.code === 0) templates.push({ path, labels: templateLabels(path, file.out) })
  }
  return templates
}
