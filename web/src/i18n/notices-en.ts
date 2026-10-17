import { en } from '../../../src/notice/en.js'

const AREA = /^(answer|chain|claude|config|storage|sync|vscode): /

/**
 * The server's English texts as the page shows them: the area a line starts with ("claude: ", "chain: ") is for the log,
 * so the page drops it, and names Codex the way the Russian texts do. `git:` and `prompt:` stay, as in Russian.
 */
export const noticesEn = Object.fromEntries(
  Object.entries(en).map(([code, render]) => [code, (params: unknown) => forPage((render as (params: unknown) => string)(params))]),
) as typeof en

function forPage(text: string): string {
  return text.replace(AREA, '').replace(/^codex: /, 'Codex: ')
}
