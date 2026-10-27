import { language } from './index.js'

const en = {
  title: 'Protection', inherit: 'Use shared protection', hint: 'Applies to new sessions. Each switch enables native deny rules. These match tool calls; they do not replace a sandbox or server-side branch protection.',
  inheritHint: 'On: the project takes the switches and rules of Protection from the shared settings, and a change there reaches it. Off: the project gets its own copy of them to change here; later changes of the shared settings no longer reach it.',
  groups: { forcePush: 'Force pushes', mirrorPush: 'Mirror pushes', deleteRemote: 'Deleting remote branches', deleteRoot: 'Recursive removal from a root or drive', deleteHome: 'Recursive removal from the home folder', deleteParent: 'Recursive removal from parent folders', deleteTracker: 'Deleting Huly records' },
  groupHints: {
    forcePush: 'Denies git push with --force, --force-with-lease or -f, which overwrites the history of a branch on the server. Claude and OpenCode also deny a +branch refspec, Codex one of the project’s main branch. Turn off to allow them.',
    mirrorPush: 'Denies git push --mirror, which makes every branch and tag on the server match the local ones and deletes the rest. Turn off to allow it.',
    deleteRemote: 'Denies git push --delete and -d, which delete a branch or a tag on the server. Claude and OpenCode also deny a :branch refspec, Codex one of the project’s main branch. Turn off to allow them.',
    deleteRoot: 'Denies rm -rf and rm -fr of /, C: and D: (on Codex also C:\\, D:\\, C:/, D:/ and /*). Claude and OpenCode deny any path that starts with them, which is every absolute path. Turn off to allow them.',
    deleteHome: 'Denies rm -rf and rm -fr of ~ and $HOME (on Codex also ~/, ~/*, $HOME/ and $HOME/*). Claude and OpenCode also deny any path inside them. Turn off to allow them.',
    deleteParent: 'Denies rm -rf and rm -fr of .., ../ and ../*, the folder above the working one. Claude and OpenCode also deny a path that starts with it, such as ../build. Turn off to allow them.',
    deleteTracker: 'Denies the delete tools of the Huly MCP server: tasks, projects, components, milestones, labels, comments, attachments, templates, drawings and replies. Applies to Claude Code, Copilot and OpenCode; Codex cannot deny MCP calls. Turn off to allow them.',
  },
  custom: 'Additional agent rules', invalid: 'Codex rules must be nonempty JSON arrays of strings.',
  native: {
    claude: 'One rule of permissions.deny per line, as in Claude Code’s settings.json: a tool name, or a tool with a pattern in brackets where * stands for any text.',
    codex: 'One JSON array of strings per line: the leading arguments of a command, matched word for word. Every command that starts with them is forbidden.',
    copilot: 'One --deny-tool rule per line: shell(<command>:*) for the leading words of a command, <server>(<tool>) for an MCP tool. A * anywhere but the trailing :* is no wildcard.',
    opencode: 'One denied bash command pattern per line: * matches any text, ? one character. All other characters are literal. These become deny entries in OpenCode’s command permissions.',
  },
  limitsLabel: 'Coverage and limits', limits: 'Codex and Copilot match literal command prefixes, including a configured remote before the flag. Other argument orders, refspecs (except, on Codex, those of the project’s main branch), shell expansions and, on Codex, MCP calls are outside their rules. Claude uses its own pattern matching. OpenCode matches command globs (* and ?) and Huly tool names; the last matching permission wins, and agent-specific overrides can take precedence. Other command spellings, shell wrappers and expansions may escape these patterns.',
  noRules: 'This agent runs without a sandbox and without any Protection command rules. Enable Protection in the session settings.',
  remote: 'Remote branch protection', unknown: 'Could not verify protection. Check access and the branch rules on the server.', unprotected: 'Force pushes or branch deletion may be allowed. Enable protection for this branch on the server.', settings: 'Open branch rules', partial: 'Rules may have administrator or allowlist bypasses. Review them on the server.',
}
const ru: typeof en = {
  title: 'Защита', inherit: 'Использовать общую защиту', hint: 'Действует для новых сессий. Каждый переключатель включает запреты агента. Они сопоставляют вызовы инструментов; песочница и защита ветки на сервере настраиваются отдельно.',
  inheritHint: 'Включено: переключатели и правила «Защиты» проект берёт из общих настроек, и их изменение до него доходит. Выключено: у проекта появляется своя копия, её можно менять здесь; дальнейшие изменения общих настроек до проекта уже не доходят.',
  groups: { forcePush: 'Принудительная отправка изменений', mirrorPush: 'Зеркальная отправка репозитория', deleteRemote: 'Удаление веток на сервере', deleteRoot: 'Рекурсивное удаление от корня или диска', deleteHome: 'Рекурсивное удаление домашней папки', deleteParent: 'Рекурсивное удаление родительских папок', deleteTracker: 'Удаление записей Huly' },
  groupHints: {
    forcePush: 'Запрещает git push с --force, --force-with-lease или -f: такая отправка переписывает историю ветки на сервере. Claude и OpenCode запрещают и refspec вида +ветка, Codex — такой refspec основной ветки проекта. Выключите, чтобы разрешить.',
    mirrorPush: 'Запрещает git push --mirror: он делает все ветки и теги на сервере такими же, как локальные, а остальные удаляет. Выключите, чтобы разрешить.',
    deleteRemote: 'Запрещает git push --delete и -d: они удаляют ветку или тег на сервере. Claude и OpenCode запрещают и refspec вида :ветка, Codex — такой refspec основной ветки проекта. Выключите, чтобы разрешить.',
    deleteRoot: 'Запрещает rm -rf и rm -fr для /, C: и D: (у Codex также C:\\, D:\\, C:/, D:/ и /*). Claude и OpenCode запрещают любой путь, который с них начинается, то есть любой абсолютный путь. Выключите, чтобы разрешить.',
    deleteHome: 'Запрещает rm -rf и rm -fr для ~ и $HOME (у Codex также ~/, ~/*, $HOME/ и $HOME/*). Claude и OpenCode запрещают и любой путь внутри них. Выключите, чтобы разрешить.',
    deleteParent: 'Запрещает rm -rf и rm -fr для .., ../ и ../*, папки над рабочей. Claude и OpenCode запрещают и путь, который с неё начинается, например ../build. Выключите, чтобы разрешить.',
    deleteTracker: 'Запрещает инструменты удаления MCP-сервера Huly: задач, проектов, компонентов, вех, меток, комментариев, вложений, шаблонов, рисунков и ответов. Действует для Claude Code, Copilot и OpenCode; Codex не умеет запрещать вызовы MCP. Выключите, чтобы разрешить.',
  },
  custom: 'Дополнительные правила агентов', invalid: 'Правила Codex должны быть непустыми JSON-массивами строк.',
  native: {
    claude: 'Одно правило permissions.deny на строку, как в settings.json Claude Code: имя инструмента или инструмент с шаблоном в скобках, где * — любой текст.',
    codex: 'Один JSON-массив строк на строку: начальные аргументы команды, сравниваются слово в слово. Запрещается любая команда, которая с них начинается.',
    copilot: 'Одно правило --deny-tool на строку: shell(<команда>:*) для начальных слов команды, <сервер>(<инструмент>) для инструмента MCP. Звёздочка в любом другом месте, кроме завершающего :*, шаблоном не считается.',
    opencode: 'Один шаблон запрещённой команды bash на строку: * — любой текст, ? — один символ. Остальные символы буквальные. Шаблоны становятся запретами в разрешениях команд OpenCode.',
  },
  limitsLabel: 'Область действия и ограничения', limits: 'Codex и Copilot сопоставляют точные префиксы команд, в том числе с именем настроенного remote перед флагом. Другой порядок аргументов, refspec (у Codex — кроме refspec основной ветки проекта), подстановки оболочки, а у Codex и вызовы MCP не охвачены. Claude использует свои шаблоны. OpenCode сопоставляет маски команд (* и ?) и имена инструментов Huly: побеждает последнее совпадение, а настройки отдельного агента могут переопределить запрет. Другие написания команд, обёртки и подстановки оболочки могут обойти шаблоны.',
  noRules: 'Агент работает без песочницы и без правил запрета команд. Включите «Защиту» в настройках сессий.',
  remote: 'Защита ветки на сервере', unknown: 'Не удалось проверить защиту. Проверьте доступ и правила ветки на сервере.', unprotected: 'Может быть разрешена принудительная отправка или удаление ветки. Включите защиту этой ветки на сервере.', settings: 'Открыть правила ветки', partial: 'У администраторов или участников списков разрешений могут быть исключения. Проверьте их на сервере.',
}
export const protectionMessages = () => language === 'ru' ? ru : en
