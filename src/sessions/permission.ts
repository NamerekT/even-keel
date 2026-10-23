import type { Language } from '../language.js'
import { chosenLabels, replyParts, type Ask } from './ask.js'

/** How much of a call's input the question shows. */
const PREVIEW_CHARS = 2000
const DENIED = 'The user denied this call: do without it.'
/** The answer to a tool the CLI wants approved while the chain runs unattended: nobody is at the page (`permissionMode` decides the rest). */
export const NO_APPROVAL = 'Nobody approves tool calls in this session: do without this call, or ask the user with AskUserQuestion.'

const TEXTS: Record<Language, { question: (tool: string) => string; header: string; allow: string; deny: string; denyHint: string }> = {
  en: {
    question: (tool) => `Allow the session to run ${tool}?`,
    header: 'Permission',
    allow: 'Allow',
    deny: 'Deny',
    denyHint: 'The session goes on without this call',
  },
  ru: {
    question: (tool) => `Разрешить сессии вызвать ${tool}?`,
    header: 'Разрешение',
    allow: 'Разрешить',
    deny: 'Отказать',
    denyHint: 'Сессия продолжит без этого вызова',
  },
}

/** What a reply to a tool approval does: an allowed call may bring the user's words along as the next message. */
export type PermissionMove = { kind: 'allow'; message: string | null } | { kind: 'deny'; message: string }

/**
 * A tool call the CLI wants approved, put to the user as a question with two options (BTN-303): the first allows it,
 * the second refuses it. The call itself is the preview of the first: a command, or the input as JSON.
 */
export function permissionAsk(id: string, tool: string, input: Record<string, unknown>, language: Language): Ask {
  const text = TEXTS[language]
  const { command, description } = input
  const shown = typeof command === 'string' ? command : JSON.stringify(input, null, 2)
  const preview = shown.length > PREVIEW_CHARS ? `${shown.slice(0, PREVIEW_CHARS)}…` : shown
  return {
    id,
    questions: [
      {
        question: text.question(tool),
        header: text.header,
        multiSelect: false,
        options: [
          { label: text.allow, description: typeof description === 'string' ? description : '', preview },
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
