import { localized } from './index.js'

export const trustTexts = localized((language) => language === 'ru' ? {
  pending: 'Доверие Claude Code будет сохранено перед запуском сессии.',
  terminalWin: 'Выполните команду в cmd и примите доверие в окне Claude Code.',
  terminal: 'Выполните команду в терминале и примите доверие в окне Claude Code.',
  serviceUser: (user: string) => `Служба работает от пользователя ${user}: примите доверие от его имени. Из терминала другого пользователя:`,
} : {
  pending: 'Claude Code trust will be saved before the session starts.',
  terminalWin: 'Run the command in cmd and accept trust in Claude Code.',
  terminal: 'Run the command in a terminal and accept trust in Claude Code.',
  serviceUser: (user: string) => `The service runs as ${user}: accept trust as that user. From another user's terminal:`,
})
