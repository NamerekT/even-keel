import { describe, expect, it } from 'vitest'
import { clockOf, fallbackUntil, recorderOf, recordingType } from './recording.js'

describe('recorderOf', () => {
  class Recorder {}
  const media = { getUserMedia: () => undefined }

  it('takes the recorder of a secure page with a microphone', () => {
    expect(recorderOf({ isSecureContext: true, MediaRecorder: Recorder, navigator: { mediaDevices: media } })).toBe(Recorder)
  })

  it('gives none on plain HTTP, without the API or without media devices', () => {
    expect(recorderOf({ isSecureContext: false, MediaRecorder: Recorder, navigator: { mediaDevices: media } })).toBeNull()
    expect(recorderOf({ isSecureContext: true, navigator: { mediaDevices: media } })).toBeNull()
    expect(recorderOf({ isSecureContext: true, MediaRecorder: Recorder, navigator: {} })).toBeNull()
  })
})

describe('recordingType', () => {
  it('prefers opus in WebM, then MP4 for Safari', () => {
    expect(recordingType(() => true)).toBe('audio/webm;codecs=opus')
    expect(recordingType((type) => type === 'audio/mp4')).toBe('audio/mp4')
  })

  it('leaves the choice to the browser when it names none of them', () => {
    expect(recordingType(() => false)).toBe('')
  })
})

describe('clockOf', () => {
  it('shows minutes and seconds', () => {
    expect(clockOf(0)).toBe('0:00')
    expect(clockOf(9_900)).toBe('0:09')
    expect(clockOf(75_000)).toBe('1:15')
  })
})

describe('fallbackUntil', () => {
  const now = 1_000_000

  it('hands the microphone to the browser for an hour on a used-up quota', () => {
    expect(fallbackUntil('dictation.quota', now)).toBe(now + 60 * 60_000)
  })

  it('hands it over for a few minutes on a failure', () => {
    expect(fallbackUntil('dictation.failed', now)).toBe(now + 5 * 60_000)
    expect(fallbackUntil('dictation.off', now)).toBe(now + 5 * 60_000)
    expect(fallbackUntil('request.tooLarge', now)).toBe(now + 5 * 60_000)
  })

  it('keeps the model after a recording of the person’s own making', () => {
    expect(fallbackUntil('dictation.empty', now)).toBeNull()
    expect(fallbackUntil('dictation.tooLong', now)).toBeNull()
  })
})
