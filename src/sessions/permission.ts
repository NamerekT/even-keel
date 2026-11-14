import type { Language } from '../language.js'
import { chosenLabels, replyParts, type Ask } from './ask.js'

/**
 * How much of a call's input the question shows: the page's preview scrolls, so a long call keeps its head and its
 * tail, where the end of a command hides as easily as its middle, and says how much is left out (BTN-1128).
 */
const HEAD_CHARS = 12_000
const TAIL_CHARS = 4_000
/** A line break, `&&`, `||`, `;` or `|`: quotes are not parsed, so a quoted one marks the command too. */
const SEVERAL_COMMANDS = /[\n;|]|&&/
const DENIED = 'The user denied this call: do without it.'
/** The answer to a tool the CLI wants approved while the chain runs unattended: nobody is at the page (`permissionMode` decides the rest). */
export const NO_APPROVAL = 'Nobody approves tool calls in this session: do without this call, or ask the user with AskUserQuestion.'

interface Texts {
  question: (tool: string, several: boolean) => string
  header: string
  allow: string
  allowHint: string
  deny: string
  denyHint: string
  says: string
  hidden: (chars: number) => string
}

const TEXTS: Record<Language, Texts> = {
  en: {
    question: (tool, several) => `Allow the session to run ${tool}${several ? ' (several commands)' : ''}?`,
    header: 'Permission',
    allow: 'Allow',
    allowHint: 'The session runs the call shown',
    deny: 'Deny',
    denyHint: 'The session goes on without this call',
    says: 'The agent says',
    hidden: (chars) => `… ${chars} characters hidden …`,
  },
  ru: {
    question: (tool, several) => `Разрешить сессии вызвать ${tool}${several ? ' (несколько команд)' : ''}?`,
    header: 'Разрешение',
    allow: 'Разрешить',
    allowHint: 'Сессия выполнит показанный вызов',
    deny: 'Отказать',
    denyHint: 'Сессия продолжит без этого вызова',
    says: 'Агент пишет',
    hidden: (chars) => `… ${chars} знаков скрыто …`,
  },
}

function cut(shown: string, text: Texts): string {
  if (shown.length <= HEAD_CHARS + TAIL_CHARS) return shown
  const hidden = shown.length - HEAD_CHARS - TAIL_CHARS
  return `${shown.slice(0, HEAD_CHARS)}\n\n${text.hidden(hidden)}\n\n${shown.slice(-TAIL_CHARS)}`
}

/** What a reply to a tool approval does: an allowed call may bring the user's words along as the next message. */
export type PermissionMove = { kind: 'allow'; message: string | null } | { kind: 'deny'; message: string }

/**
 * A tool call the CLI wants approved, put to the user as a question with two options (BTN-303): the first allows it,
 * the second refuses it. The call itself is the preview of the first: a command, or the input as JSON. The input's
 * `description` is the agent's own word on its call, so it follows the call in the preview, marked as the agent's,
 * and never stands under the allowing option (BTN-1128).
 */
export function permissionAsk(id: string, tool: string, input: Record<string, unknown>, language: Language): Ask {
  const text = TEXTS[language]
  const { command, description, ...rest } = input
  const said = typeof description === 'string' && description.trim() !== '' ? description.trim() : null
  const isCommand = typeof command === 'string'
  const shown = isCommand ? command : JSON.stringify(said === null ? input : { command, ...rest }, null, 2)
  const preview = said === null ? cut(shown, text) : `${cut(shown, text)}\n\n${text.says}: ${said}`
  return {
    id,
    questions: [
      {
        question: text.question(tool, isCommand && SEVERAL_COMMANDS.test(command.trim())),
        header: text.header,
        multiSelect: false,
        options: [
          { label: text.allow, description: text.allowHint, preview },
          { label: text.deny, description: text.denyHint },
        ],
      },
    ],
  }
}

/** The allowing option chosen allows the call; anything else refuses it, with the user's words, if any, as the reason. */
export function permissionMove(prompt: string, ask: Ask): PermissionMove {
  const question = ask.questions[0]!
  const { answers, text, files } = replyParts(prompt, ask)
  const chosen = chosenLabels(question, answers[question.question])
  const own = text !== '' || files.length > 0
  if (chosen.length === 1 && chosen[0] === question.options[0]!.label) return { kind: 'allow', message: own ? prompt.trim() : null }
  if (chosen.length === 1 && !own) return { kind: 'deny', message: DENIED }
  return { kind: 'deny', message: prompt.trim() }
}
