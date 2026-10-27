import { language } from './index.js'

const en = {
  title: 'Protection', inherit: 'Use shared protection', hint: 'Applies to new sessions. Each switch enables native deny rules. These match tool calls; they do not replace a sandbox or server-side branch protection.',
  groupHint: 'Turn off to allow the commands in this group for new sessions.',
  groups: { forcePush: 'Force pushes', mirrorPush: 'Mirror pushes', deleteRemote: 'Deleting remote branches', deleteRoot: 'Recursive removal from a root or drive', deleteHome: 'Recursive removal from the home folder', deleteParent: 'Recursive removal from parent folders', deleteTracker: 'Deleting Huly records' },
  custom: 'Additional agent rules', native: 'One native deny rule per line. Codex: one JSON array of command arguments per line. Copilot: shell(<command>:*) for a command prefix.', invalid: 'Codex rules must be nonempty JSON arrays of strings.',
  limitsLabel: 'Coverage and limits', limits: 'Codex and Copilot match literal command prefixes, including a configured remote before the flag. Other argument orders, refspecs, shell expansions and, on Codex, MCP calls are outside their rules. Claude uses its own pattern matching. OpenCode does not receive Protection rules.',
  noRules: 'This agent runs without a sandbox and without any Protection command rules. Enable Protection in the session settings.',
  unsupported: 'OpenCode does not receive Protection rules. Choose another agent in the session settings to use them.',
  remote: 'Remote branch protection', unknown: 'Could not verify protection. Check access and the branch rules on the server.', unprotected: 'Force pushes or branch deletion may be allowed. Enable protection for this branch on the server.', settings: 'Open branch rules', partial: 'Rules may have administrator or allowlist bypasses. Review them on the server.',
}
const ru: typeof en = {
  title: 'Защита', inherit: 'Использовать общую защиту', hint: 'Действует для новых сессий. Каждый переключатель включает запреты агента. Они сопоставляют вызовы инструментов; песочница и защита ветки на сервере настраиваются отдельно.',
  groupHint: 'Выключите, чтобы разрешить команды этой группы новым сессиям.',
  groups: { forcePush: 'Принудительная отправка изменений', mirrorPush: 'Зеркальная отправка репозитория', deleteRemote: 'Удаление веток на сервере', deleteRoot: 'Рекурсивное удаление от корня или диска', deleteHome: 'Рекурсивное удаление домашней папки', deleteParent: 'Рекурсивное удаление родительских папок', deleteTracker: 'Удаление записей Huly' },
  custom: 'Дополнительные правила агентов', native: 'Одно правило запрета агента на строку. Для Codex — JSON-массив аргументов команды на каждой строке. Для Copilot префикс команды пишется как shell(<команда>:*).', invalid: 'Правила Codex должны быть непустыми JSON-массивами строк.',
  limitsLabel: 'Область действия и ограничения', limits: 'Codex и Copilot сопоставляют точные префиксы команд, в том числе с именем настроенного remote перед флагом. Другой порядок аргументов, refspec, подстановки оболочки, а у Codex и вызовы MCP не охвачены. Claude использует свои шаблоны. OpenCode не получает правила «Защиты».',
  noRules: 'Агент работает без песочницы и без правил запрета команд. Включите «Защиту» в настройках сессий.',
  unsupported: 'OpenCode не получает правила «Защиты». Чтобы использовать их, выберите другого агента в настройках сессий.',
  remote: 'Защита ветки на сервере', unknown: 'Не удалось проверить защиту. Проверьте доступ и правила ветки на сервере.', unprotected: 'Может быть разрешена принудительная отправка или удаление ветки. Включите защиту этой ветки на сервере.', settings: 'Открыть правила ветки', partial: 'У администраторов или участников списков разрешений могут быть исключения. Проверьте их на сервере.',
}
export const protectionMessages = () => language === 'ru' ? ru : en
