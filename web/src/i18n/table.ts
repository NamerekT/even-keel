import { localized } from './index.js'

export const tableTexts = localized((language) => language === 'ru'
  ? { duplicate: 'Такой ключ уже есть. Измените ключ или удалите строку.' }
  : { duplicate: 'This key already exists. Change the key or remove the row.' })
