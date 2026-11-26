/** A tool as `tools/list` gives it. */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const text = { type: 'string' }
const texts = { type: 'array', items: text }
const ref = { ...texts, description: 'task keys, or #N for the N-th task of this call' }
const change = (what: string) => ({ type: 'object', properties: { add: texts, remove: texts }, additionalProperties: false, description: what })
const project = { type: 'string', description: 'project key; needed only without a project in the server address' }
const projectByDefault = { type: 'string', description: "another project by its key; none — this server's project" }
const estimate = { type: 'integer', minimum: 1, description: 'minutes of your own active work; only where the chain: line says estimate: yes' }
const field = { type: ['string', 'null'] }
const run = {
  type: 'object',
  properties: {
    provider: field,
    model: field,
    effort: field,
    machines: { type: ['array', 'null'], items: { type: 'string' }, description: 'machines of the pool by name or id; only these take the task' },
  },
  additionalProperties: false,
  description:
    "what the task's sessions run on, kept by Even Keel: a provider, its model, an effort, the machines; only when the user named one. A model needs its provider; null clears a field",
}
const tracker = (fallback: string) => ({ type: 'string', description: `one tracker of the project by its key prefix (GH of GH-12); none — ${fallback}` })

const attach = { ...texts, description: 'files of your working folder to attach: paths relative to it or absolute' }

/** The fields only some trackers keep (BTN-895): a session's tools have one only where a tracker of its project keeps it. */
export interface ToolFields {
  components: boolean
  attachments: boolean
}

/** The tool a chain session writes its handoff note with (BTN-1046): the hub keeps it for the next session. */
export const HANDOFF_TOOL = 'handoff_write'

/**
 * The five tools (BTN-768): short enough that an agent loads them at once, with no deferred schemas. Names, never ids;
 * no tool deletes anything. A chain session's address names its task (`withTask`): it gets `handoff_write` too, and no
 * `project`; an address with a project and no task (the page's chat, BTN-1747) takes `project` as an option.
 */
export function toolSpecs(withProject: boolean, fields: ToolFields = { components: true, attachments: true }, withTask = true): ToolSpec[] {
  const scoped = (properties: Record<string, unknown>) => (!withProject ? { project, ...properties } : withTask ? properties : { project: projectByDefault, ...properties })
  const extra = (component: unknown) => ({
    ...(fields.components ? { component } : {}),
    ...(fields.attachments ? { attach } : {}),
  })
  const component = { ...text, description: 'a component of the tracker, where its chain: line names components' }
  return [
    {
      name: 'tasks_list',
      description: 'Tasks of the project, one line each: key, status, milestone, title. Open tasks unless status says otherwise; every tracker of the project at once.',
      inputSchema: {
        type: 'object',
        properties: scoped({
          tracker: tracker('all of them'),
          status: { ...texts, description: 'status names; ["all"] for every status' },
          milestone: text,
          label: text,
          parent: { ...text, description: 'subtasks of this task' },
          text: { ...text, description: 'a word of the title' },
        }),
        ...(!withProject ? { required: ['project'] } : {}),
        additionalProperties: false,
      },
    },
    {
      name: 'task_read',
      description: 'A task as Markdown: a short head with the description revision, then the description, the attachments as file paths to open with Read; comments and the change history on request.',
      inputSchema: {
        type: 'object',
        properties: { key: text, comments: { type: 'boolean' }, history: { type: 'boolean', description: "who changed which field and when; only Even Keel's own tracker keeps it" } },
        required: ['key'],
        additionalProperties: false,
      },
    },
    {
      name: 'tasks_create',
      description:
        'Creates tasks with every field at once. Links inside the call go by #N and stay within one tracker. Unknown labels and milestones are refused, never created. Pass retry: a repeat with the same retry returns the tasks already created.',
      inputSchema: {
        type: 'object',
        properties: scoped({
          tracker: tracker("the session task's"),
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: text,
                description: text,
                status: text,
                priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
                milestone: text,
                labels: texts,
                estimate,
                run,
                parent: { ...text, description: 'a key, or #N of an earlier task of this call' },
                blocks: ref,
                blockedBy: ref,
                relates: ref,
                ...extra(component),
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
          retry: { ...text, description: 'any unique string of this call' },
        }),
        required: withProject ? ['tasks'] : ['project', 'tasks'],
        additionalProperties: false,
      },
    },
    {
      name: 'task_update',
      description:
        'Changes any fields at once; keys instead of key makes the same change to several tasks in one call, a line a task. Description: patches replace [{old, new}] (old found exactly once) and append need no revision; a whole description needs rev from task_read.',
      inputSchema: {
        type: 'object',
        properties: {
          key: text,
          keys: { ...texts, description: 'several tasks instead of key: the same fields, labels and links for each; no title or description edits' },
          title: text,
          status: text,
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
          milestone: { type: ['string', 'null'] },
          parent: { type: ['string', 'null'] },
          estimate,
          run: { ...run, type: ['object', 'null'] },
          labels: change('label names'),
          blocks: change('tasks this one blocks'),
          blockedBy: change('tasks that block this one'),
          relates: change('related tasks'),
          replace: {
            type: 'array',
            items: { type: 'object', properties: { old: text, new: text }, required: ['old', 'new'], additionalProperties: false },
          },
          append: { ...text, description: 'a section added at the end' },
          description: { ...text, description: 'the whole new description; needs rev' },
          rev: { type: 'integer' },
          ...extra({ ...component, type: ['string', 'null'] }),
        },
        additionalProperties: false,
      },
    },
    {
      name: 'task_comment',
      description: 'Adds a Markdown comment to a task.',
      inputSchema: {
        type: 'object',
        properties: { key: text, text, ...(fields.attachments ? { attach } : {}) },
        required: ['key', 'text'],
        additionalProperties: false,
      },
    },
    ...(withTask ? [handoffSpec] : []),
  ]
}

const handoffSpec: ToolSpec = {
  name: HANDOFF_TOOL,
  description:
    "Keeps your task's handoff note with Even Keel; a fresh session gets its text in its prompt. Write it when asked for a checkpoint, then end your turn with a last line CHECKPOINT: alone. A later call replaces the note.",
  inputSchema: {
    type: 'object',
    properties: {
      text: { ...text, description: 'what is done, what is left, the current hypotheses, what was tried and ruled out, the files and symbols that matter, the exact next command' },
    },
    required: ['text'],
    additionalProperties: false,
  },
}
