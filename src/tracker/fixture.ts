import type { Task, TaskStatus } from './model.js'

const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }

export const fakeTask = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: TODO,
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: null,
  priority: 'none',
  labels: [],
  estimate: null,
  question: false,
  models: [],
  ...fields,
})
