import { blocksOf, describeTool } from '../../src/sessions/entry.js'
import { callResult, excerpt } from './activity-result.js'
import { cleanText } from './compact.js'
import { firstPrompt } from './prompt.js'
import { noticeText } from './step-runs.js'
import { promptText, type ActivityBlock } from './stream.js'
import { startOf, type TurnEntry } from './turns.js'

/** Inputs to the session analyses. Match commands and outcomes before dropping large tool inputs and results. */
export function activityOf(entry: TurnEntry): { event: TurnEntry; prompt: string | null } | null {
  const { type, subtype, message } = entry
  const notice = noticeText(entry)
  if (type !== 'assistant' && type !== 'user' && notice === null &&
      !(type === 'system' && ['turn_duration', 'scheduled_task_fire', 'compact_boundary'].includes(subtype ?? ''))) return null

  const blocks: ActivityBlock[] = []
  let hasCall = false
  for (const block of blocksOf(message?.content)) {
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      hasCall = true
      const input = block.input ?? {}
      const { command, file_path, task_id, bash_id, shell_id } = input
      blocks.push({
        type: block.type, id: block.id, name: block.name, input: { command, file_path, task_id, bash_id, shell_id },
        brief: cleanText(describeTool(block.name, input, entry.cwd)),
      })
    } else if (block.type === 'tool_result') {
      blocks.push({ type: block.type, tool_use_id: block.tool_use_id, result: callResult(block) })
    } else if (type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: excerpt(block.text) })
    }
  }
  const userText = type === 'user' && !entry.isMeta && !entry.isCompactSummary && blocks.length === 0
  const prompt = firstPrompt([entry])
  return {
    prompt: prompt === null ? null : cleanText(prompt),
    event: {
      type, subtype, timestamp: entry.timestamp, agentId: entry.agentId, durationMs: entry.durationMs,
      turnStart: type === 'user' ? startOf(entry) : undefined,
      parentUuid: type === 'user' ? entry.parentUuid : undefined,
      isMeta: entry.isMeta, isCompactSummary: entry.isCompactSummary,
      isApiErrorMessage: entry.isApiErrorMessage, error: entry.error, usageLimitNote: typeof entry.usageLimitNote === 'string' ? '' : undefined,
      cwd: hasCall ? entry.cwd : undefined, gitBranch: hasCall ? entry.gitBranch : undefined,
      attachment: notice === null ? undefined : { prompt: notice },
      message: message === undefined ? undefined : {
        id: message.id, model: message.model === '<synthetic>' ? message.model : undefined,
        content: userText ? excerpt(promptText(message.content)) : blocks,
      },
    },
  }
}
