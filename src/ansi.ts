/** Terminal escapes: CSI (`ESC[…<letter>`, colours and cursor moves) and OSC (`ESC]…BEL`, titles and links). */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g

/** The text without terminal escapes, as a CLI or a CI log prints it into a colour terminal. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}
