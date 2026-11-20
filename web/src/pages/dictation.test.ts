import { describe, expect, it } from 'vitest'
import { dictatedText, dictationProblem, saidText, speechRecognitionOf, type SpeechResultsLike } from './dictation.js'

function results(...said: string[]): SpeechResultsLike {
  return said.map((transcript) => [{ transcript }])
}

describe('speechRecognitionOf', () => {
  class Recognizer {}

  it('takes the standard constructor, then the prefixed one', () => {
    expect(speechRecognitionOf({ isSecureContext: true, SpeechRecognition: Recognizer })).toBe(Recognizer)
    expect(speechRecognitionOf({ isSecureContext: true, webkitSpeechRecognition: Recognizer })).toBe(Recognizer)
  })

  it('gives none in a browser without the API', () => {
    expect(speechRecognitionOf({ isSecureContext: true })).toBeNull()
    expect(speechRecognitionOf({ isSecureContext: true, SpeechRecognition: 'not a constructor' })).toBeNull()
  })

  it('gives none to a page over plain HTTP', () => {
    expect(speechRecognitionOf({ isSecureContext: false, SpeechRecognition: Recognizer })).toBeNull()
    expect(speechRecognitionOf({ SpeechRecognition: Recognizer })).toBeNull()
  })
})

describe('saidText', () => {
  it('joins every result in order, trimming the leading space a continuous result has', () => {
    expect(saidText(results('hello', ' world', ' again'))).toBe('hello world again')
  })

  it('skips empty results and a result without alternatives', () => {
    expect(saidText([[{ transcript: 'one' }], [{ transcript: '  ' }], [], [{ transcript: 'two' }]])).toBe('one two')
  })

  it('is empty before anything was heard', () => {
    expect(saidText(results())).toBe('')
  })
})

describe('dictatedText', () => {
  it('fills an empty field with what was said', () => {
    expect(dictatedText('', 'hello')).toBe('hello')
  })

  it('puts a space after text that has none at its end', () => {
    expect(dictatedText('Fix it', 'and test')).toBe('Fix it and test')
  })

  it('keeps the space or newline the text already ends with', () => {
    expect(dictatedText('Fix it ', 'now')).toBe('Fix it now')
    expect(dictatedText('Line\n', 'next')).toBe('Line\nnext')
  })

  it('leaves the field as it was while nothing was heard', () => {
    expect(dictatedText('Fix it', '')).toBe('Fix it')
  })
})

describe('dictationProblem', () => {
  it('says nothing about a stop the page asked for', () => {
    expect(dictationProblem('aborted')).toBeNull()
  })

  it('names a blocked microphone, a missing one, the network and silence', () => {
    expect(dictationProblem('not-allowed')).toBe('blocked')
    expect(dictationProblem('service-not-allowed')).toBe('blocked')
    expect(dictationProblem('audio-capture')).toBe('noMicrophone')
    expect(dictationProblem('network')).toBe('network')
    expect(dictationProblem('no-speech')).toBe('silence')
  })

  it('gives any other code a general failure', () => {
    expect(dictationProblem('language-not-supported')).toBe('failed')
  })
})
