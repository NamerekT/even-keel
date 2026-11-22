import { errorText } from '../tracker/error-text.js'

/**
 * The JSON of a Linear GraphQL answer. On a 2xx status a body that broke off mid-read (a network failure after the
 * headers) or is no JSON throws, naming what happened, so it is never taken for an empty answer (BTN-1467); an empty
 * body reads as nothing. On another status an unreadable body reads as nothing: the status names the failure.
 */
export async function graphqlBody<T>(response: Response): Promise<Partial<T>> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (!response.ok) return {}
    throw new Error(`linear: the answer broke off: ${errorText(error)}`)
  }
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as Partial<T>
  } catch (error) {
    if (!response.ok) return {}
    throw new Error(`linear: the answer is no JSON: ${errorText(error)}`)
  }
}
