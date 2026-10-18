// Whether a session's last message ends with the CHECKPOINT line; whether its turn wrote the
// handoff note at its very end is Even Keel's answer (`noteAtEnd` in src/sessions/note.ts).

const MARK = /^[`*_]*CHECKPOINT:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/;

export function hasMark(text) {
  const last = (text ?? "").trimEnd().split("\n").pop() ?? "";
  return MARK.test(last.trim());
}
