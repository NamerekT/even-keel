import { afterEach, describe, expect, it } from 'vitest'
import type { EventEntry } from '../../../src/event-log/model.js'
import { notice, type Notice } from '../../../src/notice/notice.js'
import { NOTICE_LIMITS, TOAST_TITLE_LIMITS, type NoticeLanguage } from '../i18n/noticeLength.js'
import { setLanguage } from '../i18n/index.js'
import { fakeEventLog, refusedNoteError } from '../live/fakeEvents.js'
import { toastOf } from './eventToast.js'

const held = (cause: Notice | undefined): EventEntry => ({
  id: '1',
  at: '2026-11-14T10:00:00Z',
  level: 'error',
  notice: notice('eventLog.chainHeld', { project: 'p-1' }, cause === undefined ? {} : { cause }),
  place: { view: 'project', project: 'p-1' },
})

afterEach(() => setLanguage('en'))

describe('toastOf (BTN-1149)', () => {
  it('tells a chain paused on a refused PR description by the task, the cause and one thing to do', () => {
    expect(toastOf(held(refusedNoteError('ABC-5')))).toEqual({
      subject: { task: 'ABC-5', project: 'p-1' },
      title: 'pull request not opened',
      body: 'PR description .temp/note-link/pull.md refused: the file is outside the task folder. Write a safe note in the task folder, mark again and press Resume.',
    })
    setLanguage('ru')
    expect(toastOf(held(refusedNoteError('ABC-5')))).toMatchObject({
      title: 'pull request не открыт',
      body: 'Описание PR .temp/note-link/pull.md отклонено: файл находится вне папки задачи. Запишите безопасную заметку в папке задачи, повторите метку и нажмите «Снять с паузы».',
    })
  })

  it('gives the advice of the pause itself when the cause has none', () => {
    const denied = notice('review.notOpened', { task: 'ABC-5' }, { cause: notice('review.denied', { ci: 'GitHub', status: 403 }) })
    expect(toastOf(held(denied)).body).toBe(
      'GitHub: the token was refused (HTTP 403); it needs to write pull requests of the repository. Fix access and press Resume, answer its session from the chat, or skip the task.',
    )
  })

  it('is about the project when the error names no task, and keeps the pause’s own hint only for an error with nothing under it', () => {
    expect(toastOf(held(notice('chain.empty', { project: 'p-1' })))).toEqual({
      subject: { project: 'p-1' },
      title: expect.stringContaining('p-1') as string,
      body: 'Open the project to go on.',
    })
    expect(toastOf(held(undefined))).toEqual({ subject: { project: 'p-1' }, title: 'the chain paused on an error', body: 'Open the project to go on.' })
  })

  it('leaves any other entry its text after the subject and the hint of its code', () => {
    const ask: EventEntry = { id: '2', at: '2026-11-14T10:00:00Z', level: 'warning', notice: notice('eventLog.ask', { task: 'ABC-4' }), place: { view: 'ask', project: 'p-1', task: 'ABC-4' } }
    expect(toastOf(ask)).toEqual({ subject: { task: 'ABC-4', project: 'p-1' }, title: 'asks a question', body: 'Answer it in the session’s chat window.' })
  })
})

describe('the length of a toast as the page shows it (docs/web/language.md, "Short messages")', () => {
  const samples: EventEntry[] = [
    ...fakeEventLog(['ABC', 'DEMO']).filter((entry) => entry.level !== 'info'),
    held(refusedNoteError('ABC-5')),
    held(notice('review.notOpened', { task: 'ABC-5' }, { cause: notice('review.denied', { ci: 'GitHub', status: 403 }) })),
    held(notice('review.notCompleted', { task: 'ABC-5' }, { cause: notice('text', { text: 'HTTP 502' }) })),
  ]

  it.each(Object.keys(NOTICE_LIMITS) as NoticeLanguage[])('%s: a paused chain’s title is within its own short limit, every line under a title within the shared one', (language) => {
    setLanguage(language)
    const long = samples.flatMap((entry) => {
      const { title, body = '' } = toastOf(entry)
      return [
        ...(entry.notice.code === 'eventLog.chainHeld' && title.length > TOAST_TITLE_LIMITS[language] ?[`title ${title.length} > ${TOAST_TITLE_LIMITS[language]}: ${title}`] : []),
        ...(body.length > NOTICE_LIMITS[language] ? [`body ${body.length} > ${NOTICE_LIMITS[language]}: ${body}`] : []),
      ]
    })
    expect(long, 'The title says who and what happened; the cause and the one thing to do go under it').toEqual([])
  })
})
