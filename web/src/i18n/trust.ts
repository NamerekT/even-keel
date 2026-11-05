import { localized } from './index.js'

export const trustTexts = localized((language) => language === 'ru' ? {
  label: 'Доверять папке',
  hint: 'Перед запуском Claude Code в фоне Even Keel сохранит доверие к папке. Это разрешает и хуки репозитория из .claude/settings*.json. Серверы .mcp.json цепочка отключает. Выключение не отзывает уже принятое доверие.',
  pending: 'Доверие Claude Code будет сохранено перед запуском сессии.',
} : {
  label: 'Trust folder',
  hint: 'Before starting Claude Code in the background, Even Keel will save trust for this folder. This also enables repository hooks from .claude/settings*.json. The chain disables .mcp.json servers. Turning this off does not revoke existing trust.',
  pending: 'Claude Code trust will be saved before the session starts.',
})
