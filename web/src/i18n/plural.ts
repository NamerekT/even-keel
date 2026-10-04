export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

const RULES = new Map<string, Intl.PluralRules>()

export function plural(locale: string, count: number, forms: PluralForms): string {
  let rules = RULES.get(locale)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale)
    RULES.set(locale, rules)
  }
  return forms[rules.select(count)] ?? forms.other
}
