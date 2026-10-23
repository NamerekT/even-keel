import { describe, expect, it } from 'vitest'
import { replyPrompt } from '../../sessions/ask.js'
import { permissionAsk, permissionMove } from './permission.js'

const ask = permissionAsk('toolu_07', 'Bash', { command: 'npm publish', description: 'Publish the package' }, 'en')
const question = ask.questions[0]!.question
const prompt = (answer: string | undefined, text = '', files: string[] = []) =>
  replyPrompt({ from: 'page', answers: answer === undefined ? {} : { [question]: answer }, text, files }, ask, 'en')

describe('permissionAsk', () => {
  it('asks whether to allow the tool, with the call in the preview of the allowing option', () => {
    expect(ask).toEqual({
      id: 'toolu_07',
      questions: [
        {
          question: 'Allow the session to run Bash?',
          header: 'Permission',
          multiSelect: false,
          options: [
            { label: 'Allow', description: 'Publish the package', preview: 'npm publish' },
            { label: 'Deny', description: 'The session goes on without this call' },
          ],
        },
      ],
    })
  })

  it('shows the input of another tool as JSON and cuts a long one', () => {
    const edit = permissionAsk('toolu_08', 'Edit', { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }, 'ru')
    expect(edit.questions[0]).toMatchObject({ question: 'Разрешить сессии вызвать Edit?', header: 'Разрешение' })
    expect(edit.questions[0]!.options[0]).toEqual({ label: 'Разрешить', description: '', preview: '{\n  "file_path": "src/app.ts",\n  "old_string": "a",\n  "new_string": "b"\n}' })
    const long = permissionAsk('toolu_09', 'Write', { content: 'x'.repeat(5000) }, 'en').questions[0]!.options[0]!.preview!
    expect(long.length).toBeLessThan(2100)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('permissionMove', () => {
  it('allows the call when the user chose to allow it', () => {
    expect(permissionMove(prompt('Allow'), ask)).toEqual({ kind: 'allow', message: null })
  })

  it('allows the call and passes the words along when the user wrote some too', () => {
    const worded = prompt('Allow', 'And publish the docs after it.')
    expect(permissionMove(worded, ask)).toEqual({ kind: 'allow', message: worded.trim() })
  })

  it('refuses the call when the user chose to deny it', () => {
    expect(permissionMove(prompt('Deny'), ask)).toEqual({ kind: 'deny', message: 'The user denied this call: do without it.' })
  })

  it('refuses the call with the whole reply when the user answered in words of their own', () => {
    const own = prompt('Publish to the staging registry instead')
    expect(permissionMove(own, ask)).toEqual({ kind: 'deny', message: own.trim() })
    const plain = 'Not now, finish the tests first.'
    expect(permissionMove(plain, ask)).toEqual({ kind: 'deny', message: plain })
  })

  it('reads the answer in either language', () => {
    const ru = permissionAsk('toolu_10', 'Bash', { command: 'ls' }, 'ru')
    const reply = replyPrompt({ from: 'tracker', answers: { [ru.questions[0]!.question]: 'Разрешить' }, text: '', files: [] }, ru, 'ru')
    expect(permissionMove(reply, ru)).toEqual({ kind: 'allow', message: null })
  })
})
