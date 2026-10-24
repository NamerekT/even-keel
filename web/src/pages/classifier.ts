import type { SecretView } from '../../../src/state.js'

export type ClassifierField = 'url' | 'key' | 'model'

export const CLASSIFIER: Record<ClassifierField, string> = { url: 'TALLY_LLM_URL', key: 'TALLY_LLM_KEY', model: 'TALLY_LLM_MODEL' }

export const CLASSIFIER_FIELDS = Object.keys(CLASSIFIER) as ClassifierField[]

/** The variable behind a field, as the service shows it. */
export const classifierVariable = (variables: readonly SecretView[], field: ClassifierField): SecretView | undefined =>
  variables.find((each) => each.name === CLASSIFIER[field])

/** The form as it opens: the saved address and model; the key, a secret, blank. */
export function classifierDraft(variables: readonly SecretView[]): Record<ClassifierField, string> {
  const value = (field: ClassifierField) => classifierVariable(variables, field)?.value ?? ''
  return { url: value('url'), key: '', model: value('model') }
}

/**
 * What `secrets/update` gets: a changed field, `null` for one cleared that was set; a blank key keeps the saved one,
 * and a variable from the service's environment is not the page's to change.
 */
export function classifierChanges(variables: readonly SecretView[], draft: Record<ClassifierField, string>): Record<string, string | null> {
  const changes: Record<string, string | null> = {}
  for (const field of CLASSIFIER_FIELDS) {
    const variable = classifierVariable(variables, field)
    const value = draft[field].trim()
    if (variable === undefined || variable.outer) continue
    if (field === 'key') {
      if (value !== '') changes[variable.name] = value
    } else if (value === '') {
      if (variable.set) changes[variable.name] = null
    } else if (value !== variable.value) changes[variable.name] = value
  }
  return changes
}
