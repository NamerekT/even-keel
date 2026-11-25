import type { MenuEntry } from '../../../src/sessions/commands.js'

/** `chat/menu` in `dev:fake` (BTN-1695): a user command and skills, and the skills of a package plugin. */
export const FAKE_MENU: MenuEntry[] = [
  { name: 'deploy', kind: 'command', from: 'user', description: 'Deploy the build to an environment', args: '<env>' },
  { name: 'coding', kind: 'skill', from: 'user', description: 'Working rules for any task that writes or edits code', args: '' },
  { name: 'review-diff', kind: 'skill', from: 'user', description: 'Review the branch against its main branch', args: '' },
  { name: 'tasks:split', kind: 'skill', from: 'package', description: 'Size of a task and splitting it into subtasks', args: '[task]' },
  { name: 'tasks:task', kind: 'skill', from: 'package', description: 'Working a task through the tasks server', args: '' },
]
