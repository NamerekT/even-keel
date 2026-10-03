import { lineDiff } from '../../src/stats/diff.js'
import { blocksOf, type Entry } from '../../src/sessions/entry.js'
import { canon, hashOf, lineCount, ruleFileOf, shellRuleFiles, skillBody, skillDescriptions, type RuleFile } from './rules.js'

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export interface RuleContext {
  home: string
  skills: ReadonlyMap<string, RuleFile>
}

export interface RuleTextRow {
  hash: string
  content: string
  lines: number
}

export interface RuleSeenRow {
  sessionId: string
  key: string
  hash: string
  at: string
}

export interface RuleEditRow {
  toolUseId: string
  sessionId: string | null
  agentId: string | null
  key: string
  at: string | null
  tool: string
  added: number
  removed: number | null
}

export interface RuleRows {
  ruleTexts: Map<string, RuleTextRow>
  ruleFiles: Map<string, RuleFile>
  ruleSeen: Map<string, RuleSeenRow>
  ruleEdits: Map<string, RuleEditRow>
}

export function emptyRuleRows(): RuleRows {
  return { ruleTexts: new Map(), ruleFiles: new Map(), ruleSeen: new Map(), ruleEdits: new Map() }
}

type Fields = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export function addRuleText(rows: RuleRows, file: RuleFile, content: string): string {
  const hash = hashOf(content)
  if (!rows.ruleTexts.has(hash)) rows.ruleTexts.set(hash, { hash, content, lines: lineCount(content) })
  if (!rows.ruleFiles.has(file.key)) rows.ruleFiles.set(file.key, file)
  return hash
}

// Reads what a session got from its rule files (instructions, nested CLAUDE.md, skill listing and invoked skill
// texts) and the edits it made to them. Skill invocations with arguments are skipped: the CLI appends them to the body.
export class RuleCollector {
  private readonly skillArgs = new Map<string, boolean>()

  constructor(private readonly context: RuleContext) {}

  push(rows: RuleRows, entry: Entry): void {
    const sessionId = typeof entry.sessionId === 'string' && entry.sessionId !== '' ? entry.sessionId : null
    const at = text(entry.timestamp)
    if (entry.type === 'assistant') this.pushEdits(rows, entry, sessionId, at)
    if (sessionId === null || at === null) return
    if (entry.type === 'attachment') this.pushAttachment(rows, entry.attachment as Fields | undefined, sessionId, at)
    else if (entry.type === 'user' && entry.isMeta === true) this.pushSkill(rows, entry, sessionId, at)
  }

  private seen(rows: RuleRows, file: RuleFile | null, content: string | null, sessionId: string, at: string): void {
    if (file === null || content === null) return
    const hash = addRuleText(rows, file, canon(content))
    const id = `${sessionId}|${file.key}|${hash}`
    const known = rows.ruleSeen.get(id)
    if (known === undefined || at < known.at) rows.ruleSeen.set(id, { sessionId, key: file.key, hash, at })
  }

  private pushAttachment(rows: RuleRows, attachment: Fields | undefined, sessionId: string, at: string): void {
    if (attachment === undefined) return
    if (attachment.type === 'instructions' && Array.isArray(attachment.files)) {
      for (const each of attachment.files as Fields[]) {
        const path = text(each.path)
        if (path !== null) this.seen(rows, ruleFileOf(path, this.context.home), text(each.content), sessionId, at)
      }
    } else if (attachment.type === 'nested_memory') {
      const inner = attachment.content as Fields | undefined
      const path = text(inner?.path) ?? text(attachment.path)
      if (path !== null) this.seen(rows, ruleFileOf(path, this.context.home), text(inner?.content), sessionId, at)
    } else if (attachment.type === 'skill_listing' && Array.isArray(attachment.names)) {
      const content = text(attachment.content)
      if (content === null) return
      const names = (attachment.names as unknown[]).filter((name): name is string => typeof name === 'string')
      for (const [name, description] of skillDescriptions(content, names)) {
        const skill = this.context.skills.get(name)
        if (skill === undefined) continue
        const file = { ...skill, key: `${skill.key}#description`, display: `${skill.display}#description` }
        this.seen(rows, file, description, sessionId, at)
      }
    }
  }

  private pushSkill(rows: RuleRows, entry: Entry, sessionId: string, at: string): void {
    const source = (entry as Fields).sourceToolUseID
    if (typeof source !== 'string' || this.skillArgs.get(source) !== false) return
    const first = blocksOf(entry.message?.content)[0]
    const raw = typeof entry.message?.content === 'string' ? entry.message.content : first?.text
    const skill = typeof raw === 'string' ? skillBody(raw) : null
    if (skill === null) return
    this.seen(rows, ruleFileOf(`${skill.dir}/SKILL.md`, this.context.home), skill.body, sessionId, at)
  }

  private pushEdits(rows: RuleRows, entry: Entry, sessionId: string | null, at: string | null): void {
    for (const block of blocksOf(entry.message?.content)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') continue
      const input = block.input ?? {}
      if (block.name === 'Skill') {
        const args = input.args
        this.skillArgs.set(block.id, typeof args === 'string' && args.trim() !== '')
        continue
      }
      if (SHELL_TOOLS.has(block.name)) {
        const command = text(input.command)
        const files = command === null ? [] : shellRuleFiles(command, text(entry.cwd), this.context.home)
        files.forEach((file, index) => {
          if (!rows.ruleFiles.has(file.key)) rows.ruleFiles.set(file.key, file)
          const toolUseId = index === 0 ? block.id! : `${block.id}:${index}`
          rows.ruleEdits.set(toolUseId, { toolUseId, sessionId, agentId: text(entry.agentId), key: file.key, at, tool: block.name!, added: 0, removed: null })
        })
        continue
      }
      if (!EDIT_TOOLS.has(block.name)) continue
      const path = text(input.file_path)
      const file = path === null ? null : ruleFileOf(path, this.context.home)
      if (file === null) continue
      if (!rows.ruleFiles.has(file.key)) rows.ruleFiles.set(file.key, file)
      rows.ruleEdits.set(block.id, {
        toolUseId: block.id,
        sessionId,
        agentId: text(entry.agentId),
        key: file.key,
        at,
        tool: block.name,
        ...editSize(block.name, input),
      })
    }
  }
}

function editSize(tool: string, input: Fields): { added: number; removed: number | null } {
  if (tool === 'Write') return { added: lineCount(canon(text(input.content) ?? '')), removed: null }
  const edits = tool === 'MultiEdit' && Array.isArray(input.edits) ? (input.edits as Fields[]) : [input]
  let added = 0
  let removed = 0
  for (const edit of edits) {
    const diff = lineDiff(text(edit.old_string) ?? '', text(edit.new_string) ?? '')
    added += diff.added
    removed += diff.removed
  }
  return { added, removed }
}
