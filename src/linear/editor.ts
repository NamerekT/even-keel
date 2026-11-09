import { randomUUID } from 'node:crypto'
import { sameName } from '../chain/rules.js'
import { descriptionEdits, EditRefused, type TaskEditor } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { parseTaskId, type TaskPriority, type TrackerTask } from '../tracker/model.js'
import { TrackerNotFound } from '../tracker/source.js'
import { linearStatus, type LinearState } from './model.js'

interface TeamState extends LinearState {
  id: string
}

export interface LinearEditorDeps {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  /** The team of Even Keel's project and the Linear project it is narrowed to, if any. */
  teamOf(project: string): Promise<{ id: string; states: TeamState[]; project?: string }>
  /** Every issue of Even Keel's project, open and closed. */
  list(project: string): Promise<TrackerTask[]>
  relabel(id: string, change: LabelChange): Promise<string[]>
  comment(id: string, body: string): Promise<string>
}

interface EditIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  priority: number
  state: { id: string }
  parent: { id: string; identifier: string } | null
  project: { id: string } | null
  projectMilestone: { id: string; name: string } | null
  team: { id: string; key: string; states: { nodes: TeamState[] } }
  relations: { nodes: { id: string; type: string; relatedIssue: { id: string } }[] }
}

export const LINEAR_PRIORITY: Readonly<Record<TaskPriority, number>> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }

const EDIT_ISSUE = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) {
    nodes {
      id identifier title description priority
      state { id }
      parent { id identifier }
      project { id }
      projectMilestone { id name }
      team { id key states(first: 100) { nodes { id name type } } }
      relations(first: 50) { nodes { id type relatedIssue { id } } }
    }
  }
}`

/** The milestones of the team's Linear projects: Linear keeps a milestone in a project, not in a team. */
const TEAM_MILESTONES = `query($team: String!) {
  team(id: $team) { projects(first: 50) { nodes { id projectMilestones(first: 50) { nodes { id name } } } } }
}`

const MARKED_ISSUE = `query($filter: IssueFilter!) {
  issues(first: 1, filter: $filter) { nodes { identifier } }
}`

const CREATE_ISSUE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier } }
}`

const UPDATE_ISSUE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`

const CREATE_RELATION = `mutation($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) { success }
}`

const DELETE_RELATION = `mutation($id: String!) {
  issueRelationDelete(id: $id) { success }
}`

interface MilestonePlace {
  project: string
  milestone: string
  name: string
}

/** The milestones of `project`, or of every project of the team (its id or key) when `project` is `undefined`. */
export async function teamMilestones(graphql: LinearEditorDeps['graphql'], team: string, project: string | undefined): Promise<MilestonePlace[]> {
  type Projects = { team: { projects: { nodes: { id: string; projectMilestones: { nodes: { id: string; name: string }[] } }[] } } | null }
  const { team: found } = await graphql<Projects>(TEAM_MILESTONES, { team })
  return (found?.projects.nodes ?? [])
    .filter((each) => project === undefined || each.id === project)
    .flatMap((each) => each.projectMilestones.nodes.map((milestone) => ({ project: each.id, milestone: milestone.id, name: milestone.name })))
}

/**
 * Linear's writes for the tasks MCP server (BTN-875). Statuses are the team's workflow states, priority and parent are
 * native, a milestone is a project milestone found by name among the team's projects (the issue's own project, when it
 * has one), links are issue relations. Linear keeps no revision of a description, so the revision is a hash.
 */
export function linearEditor(deps: LinearEditorDeps): TaskEditor {
  const { graphql } = deps

  const issueOf = async (id: string): Promise<EditIssue> => {
    const parsed = parseTaskId(id)
    if (parsed === null) throw new EditRefused(`"${id}" is not a task key such as ABC-12`)
    const { issues } = await graphql<{ issues: { nodes: EditIssue[] } }>(EDIT_ISSUE, { filter: { team: { key: { eq: parsed.project } }, number: { eq: parsed.number } } })
    const issue = issues.nodes[0]
    if (issue === undefined) throw new TrackerNotFound(`linear: issue ${id} not found or the key cannot see it`)
    return issue
  }
  const update = async (issue: EditIssue, input: Record<string, unknown>): Promise<true> => {
    const { issueUpdate } = await graphql<{ issueUpdate: { success: boolean } }>(UPDATE_ISSUE, { id: issue.id, input })
    if (!issueUpdate.success) throw new Error(`linear: ${issue.identifier} was not updated`)
    return true
  }
  const stateOf = (states: TeamState[], name: string): TeamState => {
    const found = states.find((state) => sameName(state.name, name))
    if (found === undefined) throw new EditRefused(`there is no status "${name}" in the team; the statuses are ${states.map((state) => state.name).join(', ')}`)
    return found
  }
  /** The milestone by name in `project`, or in any project of the team when `project` is `undefined`. */
  const milestoneOf = async (team: string, name: string, project: string | undefined): Promise<MilestonePlace> => {
    const places = (await teamMilestones(graphql, team, project)).filter((each) => sameName(each.name, name))
    if (places.length === 0) throw new EditRefused(`there is no milestone "${name}" in ${project === undefined ? 'the projects of the team' : "the task's Linear project"}`)
    if (places.length > 1) throw new EditRefused(`several Linear projects of the team have a milestone "${name}"; put the task into its project in Linear first`)
    return places[0]!
  }

  return {
    list: (project) => deps.list(project),
    async create(project, draft, _notes, marker) {
      const team = await deps.teamOf(project)
      const state = draft.status === null ? (team.states.find((each) => linearStatus(each).category === 'UnStarted') ?? team.states[0]) : stateOf(team.states, draft.status)
      if (state === undefined) throw new EditRefused('the team has no statuses')
      const parent = draft.parent === null ? null : await issueOf(draft.parent)
      const place = draft.milestone === null ? null : await milestoneOf(team.id, draft.milestone, parent?.project?.id ?? team.project)
      const projectId = place?.project ?? parent?.project?.id ?? team.project
      const input = {
        ...(marker === undefined ? {} : { id: marker }),
        teamId: team.id,
        title: draft.title,
        description: draft.description,
        priority: LINEAR_PRIORITY[draft.priority ?? 'none'],
        stateId: state.id,
        ...(projectId === undefined ? {} : { projectId }),
        ...(place === null ? {} : { projectMilestoneId: place.milestone }),
        ...(parent === null ? {} : { parentId: parent.id }),
      }
      const { issueCreate } = await graphql<{ issueCreate: { success: boolean; issue: { identifier: string } | null } }>(CREATE_ISSUE, { input })
      if (!issueCreate.success || issueCreate.issue === null) throw new Error('linear: the issue was not created')
      const id = issueCreate.issue.identifier
      if (draft.labels.length > 0) await deps.relabel(id, { add: draft.labels, remove: [] })
      return id
    },
    // The marker is the issue's own id: `issueCreate` takes a UUID v4 chosen by the caller.
    markers: {
      make: () => randomUUID(),
      async find(project, marker) {
        const team = await deps.teamOf(project)
        const { issues } = await graphql<{ issues: { nodes: { identifier: string }[] } }>(MARKED_ISSUE, { filter: { id: { eq: marker }, team: { id: { eq: team.id } } } })
        return issues.nodes[0]?.identifier ?? null
      },
    },
    async set(id, field) {
      const issue = await issueOf(id)
      switch (field.field) {
        case 'title':
          return issue.title === field.to ? false : update(issue, { title: field.to })
        case 'status': {
          const state = stateOf(issue.team.states.nodes, field.to)
          return issue.state.id === state.id ? false : update(issue, { stateId: state.id })
        }
        case 'priority': {
          const priority = LINEAR_PRIORITY[field.to]
          return issue.priority === priority ? false : update(issue, { priority })
        }
        case 'milestone': {
          if (field.to === null) return issue.projectMilestone === null ? false : update(issue, { projectMilestoneId: null })
          if (issue.projectMilestone !== null && sameName(issue.projectMilestone.name, field.to)) return false
          const place = await milestoneOf(issue.team.key, field.to, issue.project?.id)
          return update(issue, { ...(issue.project === null ? { projectId: place.project } : {}), projectMilestoneId: place.milestone })
        }
        case 'parent': {
          if (issue.parent?.identifier.toUpperCase() === field.to?.toUpperCase() || (issue.parent === null && field.to === null)) return false
          if (field.to === null) return update(issue, { parentId: null })
          const parent = await issueOf(field.to)
          if (parent.id === issue.id) throw new EditRefused(`${issue.identifier} cannot be its own parent`)
          return update(issue, { parentId: parent.id })
        }
      }
    },
    ...descriptionEdits({
      read: async (id) => (await issueOf(id)).description ?? '',
      write: async (id, text) => void (await update(await issueOf(id), { description: text })),
    }),
    async link(id, other, link, on) {
      const [issue, target] = await Promise.all([issueOf(id), issueOf(other)])
      if (issue.id === target.id) throw new EditRefused(`${issue.identifier} cannot be linked to itself`)
      const [from, to] = link === 'blockedBy' ? [target, issue] : [issue, target]
      const type = link === 'relates' ? 'related' : 'blocks'
      const between = (a: EditIssue, b: EditIssue) => a.relations.nodes.filter((each) => each.type === type && each.relatedIssue.id === b.id)
      const found = link === 'relates' ? [...between(from, to), ...between(to, from)] : between(from, to)
      if ((found.length > 0) === on) return
      if (on) {
        const { issueRelationCreate } = await graphql<{ issueRelationCreate: { success: boolean } }>(CREATE_RELATION, { input: { issueId: from.id, relatedIssueId: to.id, type } })
        if (!issueRelationCreate.success) throw new Error(`linear: the link of ${issue.identifier} and ${target.identifier} was not created`)
        return
      }
      for (const each of found) await graphql(DELETE_RELATION, { id: each.id })
    },
    relabel: (id, change) => deps.relabel(id, change),
    // A Linear comment has no field for the session's model: its author is the key's account.
    comment: (id, body) => deps.comment(id, body),
  }
}
