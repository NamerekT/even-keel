import { describe, expect, it } from 'vitest'
import { en } from './en.js'
import { keyList, KEYS_SHOWN } from './keys.js'
import { ru } from './ru.js'

const keys = (count: number) => Array.from({ length: count }, (_, index) => `ABC-${index + 1}`)

describe('keyList', () => {
  it('lists every key up to the cut', () => {
    expect(keyList(keys(KEYS_SHOWN), (count) => `+${count}`)).toBe(keys(KEYS_SHOWN).join(', '))
  })

  it('cuts a longer list and counts the rest', () => {
    const text = keyList(keys(1000), (count) => `and ${count} more`)
    expect(text).toBe(`${keys(KEYS_SHOWN).join(', ')} and ${1000 - KEYS_SHOWN} more`)
  })

  it('names the rest in each language', () => {
    expect(en.common.taskKeys(keys(22))).toBe(`${keys(20).join(', ')} and 2 more`)
    expect(ru.common.taskKeys(keys(22))).toBe(`${keys(20).join(', ')} и ещё 2`)
  })

  it('cuts the transfer tips', () => {
    expect(en.transfer.lossTip(keys(25))).toBe(`${keys(20).join(', ')} and 5 more`)
    expect(ru.transfer.checkShort(keys(25))).toBe(`Не хватает у задач ${keys(20).join(', ')} и ещё 5`)
  })
})
