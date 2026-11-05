import { localized } from './index.js'

export const trustTexts = localized((language) => language === 'ru' ? {
  pending: 'Доверие Claude Code будет сохранено перед запуском сессии.',
} : {
  pending: 'Claude Code trust will be saved before the session starts.',
})
