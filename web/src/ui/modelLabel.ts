/** Model families as people write them, by the word a model id starts with (`claude-opus-…` → `opus`). */
export const MODEL_FAMILIES: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
  sol: 'Sol',
  luna: 'Luna',
  astra: 'Astra',
  terra: 'Terra',
  gpt: 'GPT',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  gemini: 'Gemini',
  kimi: 'Kimi',
  glm: 'GLM',
  mistral: 'Mistral',
  llama: 'Llama',
  minimax: 'MiniMax',
}

/** 'claude-opus-5-5' → 'Opus 5.5', a trailing date dropped, a dotted version too (`claude-sonnet-4.5`); anything not a Claude model stays as it is. */
export function modelVersionLabel(model: string): string {
  const match = /^claude-([a-z]+)((?:[-.]\d{1,2})+)(?:-\d{8})?$/.exec(model)
  if (match === null) return model
  return `${MODEL_FAMILIES[match[1]!] ?? match[1]} ${match[2]!.slice(1).replaceAll('-', '.')}`
}

/** `NVIDIA: `, `Anthropic: ` — the vendor before a catalogue name. */
const VENDOR = /^[^:/]{1,40}:\s+/
const FREE_NAME = /\s*\(free\)$/i
const FREE_ID = /:free$/

/**
 * A model as the page shows it: the catalogue's name when the session's agent has one (`title`, OpenCode's copy of
 * models.dev), its vendor cut; else the id without its route, a Claude id as "Opus 5.5" and a GPT one as "GPT-5.1".
 * OpenRouter's `:free` is no part of the name but `free`, a badge beside it. A long name is not shortened here: its
 * place cuts it with an ellipsis and keeps it whole in the tip.
 */
export function shortModel(model: string, title?: string | null): { name: string; free: boolean } {
  const free = FREE_ID.test(model)
  const named = title?.replace(VENDOR, '').replace(FREE_NAME, '').trim() ?? ''
  if (named !== '') return { name: named, free }
  const id = model.slice(model.lastIndexOf('/') + 1).replace(FREE_ID, '')
  return { name: id.startsWith('gpt-') ? `GPT-${id.slice(4)}` : modelVersionLabel(id), free }
}

/** The tip's text of a model: its full name and id, or the id alone when the name is the id. */
export function modelTip(model: string, title?: string | null): string {
  const name = title?.trim() || shortModel(model).name
  return name === model ? model : `${name} (${model})`
}
