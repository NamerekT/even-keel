export const RULE_PURPOSES = ['economy', 'quality', 'process', 'infra'] as const
export type RulePurpose = (typeof RULE_PURPOSES)[number]

export const IMPORT_PRECISIONS = ['exact', 'hour', 'day'] as const
export type ImportPrecision = (typeof IMPORT_PRECISIONS)[number]

export const IMPORT_ACTIONS = ['added', 'changed', 'removed'] as const
export type ImportAction = (typeof IMPORT_ACTIONS)[number]

export interface ImportFile {
  path: string
  action: ImportAction
  summary: string
  precision: ImportPrecision | null
  at: string | null
}

// One set of rule edits from the history import (`rule-history.jsonl`), written by hand or by another agent.
export interface RuleImport {
  id: string
  at: string
  until: string | null
  precision: ImportPrecision
  sessions: string[]
  files: ImportFile[]
  purpose: RulePurpose[]
  reason: string
  task: string | null
  source: string
}
