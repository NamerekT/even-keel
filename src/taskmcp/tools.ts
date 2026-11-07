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

/**
 * The five tools (BTN-768): short enough that an agent loads them at once, with no deferred schemas. Names, never ids;
 * no tool deletes anything.
 */
export function toolSpecs(withProject: boolean): ToolSpec[] {
  const scoped = (properties: Record<string, unknown>) => (withProject ? properties : { project, ...properties })
  return [
    {
      name: 'tasks_list',
      description: 'Tasks of the project, one line each: key, status, milestone, title. Open tasks unless status says otherwise.',
      inputSchema: {
        type: 'object',
        properties: scoped({
          status: { ...texts, description: 'status names; ["all"] for every status' },
          milestone: text,
          label: text,
          parent: { ...text, description: 'subtasks of this task' },
          text: { ...text, description: 'a word of the title' },
        }),
        additionalProperties: false,
      },
    },
    {
      name: 'task_read',
      description: 'A task as Markdown: a short head with the description revision, then the description, the attachments as file paths to open with Read; comments on request.',
      inputSchema: { type: 'object', properties: { key: text, comments: { type: 'boolean' } }, required: ['key'], additionalProperties: false },
    },
    {
      name: 'tasks_create',
      description:
        'Creates tasks with every field at once. Links inside the call go by #N. Unknown labels and milestones are refused, never created. Pass retry: a repeat with the same retry returns the tasks already created.',
      inputSchema: {
        type: 'object',
        properties: scoped({
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
                parent: { ...text, description: 'a key, or #N of an earlier task of this call' },
                blocks: ref,
                blockedBy: ref,
                relates: ref,
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
          retry: { ...text, description: 'any unique string of this call' },
        }),
        required: ['tasks'],
        additionalProperties: false,
      },
    },
    {
      name: 'task_update',
      description:
        'Changes any fields at once. Description: patches replace [{old, new}] (old found exactly once) and append need no revision; a whole description needs rev from task_read.',
      inputSchema: {
        type: 'object',
        properties: {
          key: text,
          title: text,
          status: text,
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
          milestone: { type: ['string', 'null'] },
          parent: { type: ['string', 'null'] },
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
        },
        required: ['key'],
        additionalProperties: false,
      },
    },
    {
      name: 'task_comment',
      description: 'Adds a Markdown comment to a task.',
      inputSchema: { type: 'object', properties: { key: text, text }, required: ['key', 'text'], additionalProperties: false },
    },
  ]
}
