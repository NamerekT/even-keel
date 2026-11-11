// Whether a session's last message ends with the CHECKPOINT line; whether its turn wrote the
// handoff note at its very end is Even Keel's answer (`noteWritten` in src/sessions/note.ts).

const MARK = /^[`*_]*CHECKPOINT:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/;

// The shared note, and a task's own one in a project without git, whose folder every task shares (BTN-964).
export const NOTE = ".temp/handoff.md";
const OWN_NOTE = /^\.temp\/handoff(?:-[A-Za-z0-9._-]+)?\.md$/;
const NOTE_PATH = /(^|\/)\.temp\/handoff(?:-[A-Za-z0-9._-]+)?\.md$/;

export function hasMark(text) {
  const last = (text ?? "").trimEnd().split("\n").pop() ?? "";
  return MARK.test(last.trim());
}

/** The note Even Keel named, or the shared one when it named none, or anything else: an older Even Keel. */
export const noteIn = (value) => (typeof value === "string" && OWN_NOTE.test(value) ? value : NOTE);

/** Whether a written path is a handoff note, the shared one or a task's own. */
export const isNotePath = (path) => typeof path === "string" && NOTE_PATH.test(path.replace(/\\/g, "/"));
