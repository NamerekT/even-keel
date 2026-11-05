/**
 * Writes `web/src/i18n/notice-lengths.json`: the server messages still longer than the limit (`web/src/i18n/noticeLength.ts`).
 * `web/src/i18n/noticeLength.test.ts` fails when a text grows past it and asks to run this when one got shorter.
 */
import { writeFileSync } from 'node:fs'
import { overLimit } from '../web/src/i18n/noticeLength.js'

const over = overLimit()
writeFileSync('web/src/i18n/notice-lengths.json', `${JSON.stringify(over, null, 2)}\n`)
console.log(`over the limit: ${Object.keys(over.en).length} English, ${Object.keys(over.ru).length} Russian`)
