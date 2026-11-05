import { localized } from './index.js'

export const trustTexts = localized((language) => language === 'ru' ? {
  pending: 'Доверие Claude Code будет сохранено перед запуском сессии.',
  shell: { cmd: 'cmd', powershell: 'PowerShell', terminal: null },
  asUser: (user: string) => `от имени ${user}`,
} : {
  pending: 'Claude Code trust will be saved before the session starts.',
  shell: { cmd: 'cmd', powershell: 'PowerShell', terminal: null },
  asUser: (user: string) => `as ${user}`,
})
