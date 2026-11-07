import type { Messages } from './ru.js'

export const demoEn: Messages['demo'] = {
  welcome: 'Welcome to Even Keel',
  lead: "Even Keel takes a project's tasks from the tracker and runs an agent's session on each in turn. You can see what it looks like first, or connect your own project right away.",
  watch: 'Watch the demo',
  watchTitle: 'Demo',
  watchHint: 'About two minutes. The chain goes through three tasks before your eyes, and one of them asks you in the chat. The agent is a script: no account and no money needed.',
  connect: 'Connect your own',
  connectTitle: 'Your project',
  connectHint: 'The agent, its account and the tracker, then the repository. The demo can be watched later too.',
  banner: 'This is the demo: the agent is a script, nothing is spent',
  remove: 'Remove',
  removeTitle: 'Remove the demo',
  removeQuestion: 'The demo is still running. Its session stops, and the project, its tasks and its folder are deleted.',
  removeCancel: 'Keep it',
  endTitle: 'The demo is over',
  endText: 'The chain went through every task: a session did each, its branch merged into the main one, the task closed. Your own project runs the same way, only with a real agent.',
  again: 'Run again',
  more: 'More demo actions',
  wizardRemove: 'Remove the demo',
  wizardRemoveHint: "The demo's project, its tasks and its folder are deleted once your project is added.",
}
