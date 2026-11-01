/** A line glued under a field (`FieldStrip`): what the field's value was found as, or what is wrong with it. */
export interface StripLine {
  tone: 'ok' | 'error' | 'plain'
  text: string
  /** The same said shorter, for a field too narrow for `text`: the login alone for "signed in as <login>". */
  short?: string
}

export type StripFit = 'full' | 'short' | 'cut'

/** What a strip with `room` pixels for its text shows: the whole text, the short one, or the text cut with its whole in a tip. */
export function stripFit(room: number, full: number, short: number | null): StripFit {
  // The text is measured to a fraction of a pixel, the room is a whole width: half a pixel over is still a fit.
  const fits = (width: number) => width <= room + 0.5
  if (fits(full)) return 'full'
  if (short !== null && fits(short)) return 'short'
  return 'cut'
}
