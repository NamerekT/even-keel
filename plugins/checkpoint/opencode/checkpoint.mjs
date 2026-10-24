// The checkpoint package's hooks for OpenCode, whose hooks are JS plugins run inside its own process: Even Keel
// loads every script of this folder into a chain session's config. After each tool call the plugin asks Even Keel
// what the hook commands of Claude Code and Codex ask (../hooks/evenkeel.mjs) — the checkpoint nudge due and the
// chat's waiting messages — and puts them after the tool's output, the only way into the context in the middle of
// a turn. A delivered message is also kept in the call's metadata, where Even Keel's feed finds it. Before a shell
// call that merges the task branch it runs the project's check, and an error thrown there keeps the call from running.
// The project's standards (../hooks/standards.mjs) work as in the hook commands: a read of a guarded file gets the
// document after its output, a first edit before it is refused by an error, and a compaction forgets what was given.
// `opencode run` has no Stop to block, so a turn that wrote the handoff note and ends without the CHECKPOINT line gets
// the line added to its text as it completes; for the same reason PR mode's mark is not held for the standards. A
// subagent runs in a session of its own, which Even Keel does not know, so it is left alone. Only `server` is
// exported: OpenCode takes the module's exports for plugins.
import { checkOf, checkpointNote, mailOf, noteAtEnd, STATE_DIR, standardsOf } from "../hooks/evenkeel.mjs";
import { hasMark } from "../hooks/handoff.mjs";
import { mergeRefusal } from "../hooks/merges.mjs";
import { callOf, clearGiven, due, givenStore, standardsAt } from "../hooks/standards.mjs";

const MARK = "CHECKPOINT: .temp/handoff.md";
const WRITES = new Set(["write", "edit", "multiedit"]);
// Even Keel counts the note when it is among the turn's last three tool calls (`noteAtEnd` in src/sessions/note.ts).
const NEAR_END = 3;

const reminder = (text) => `\n\n<system-reminder>\n${text}\n</system-reminder>`;
const isNote = (path) => typeof path === "string" && /(^|\/)\.temp\/handoff\.md$/.test(path.replace(/\\/g, "/"));

export const server = async ({ directory }) => {
  // Per session, the tool calls since this process saw it write the note: Even Keel is asked only then.
  const sinceNote = new Map();
  const counted = (input) => {
    if (WRITES.has(input.tool) && isNote(input.args?.filePath)) sinceNote.set(input.sessionID, 0);
    else if (sinceNote.has(input.sessionID)) {
      const calls = sinceNote.get(input.sessionID) + 1;
      if (calls < NEAR_END) sinceNote.set(input.sessionID, calls);
      else sinceNote.delete(input.sessionID);
    }
  };

  // What a read or an edit gets from the project's standards; Even Keel not answering leaves the call alone.
  const standard = async (moment, input, args) => {
    if (!due(moment, callOf(input.tool, args))) return null;
    const standards = await standardsOf(input.sessionID).catch(() => []);
    if (standards.length === 0) return null;
    return standardsAt(moment, input.tool, args, directory, standards, givenStore(STATE_DIR, input.sessionID));
  };

  return {
    "tool.execute.before": async (input, output) => {
      if (typeof input?.sessionID !== "string") return;
      if (input.tool !== "bash") {
        const found = await standard("before", input, output?.args).catch(() => null);
        if (found?.deny !== undefined) throw new Error(found.deny);
        return;
      }
      // Even Keel not answering, or git failing, must never block a merge.
      const text = await mergeRefusal(output?.args?.command, directory, () => checkOf(input.sessionID)).catch(() => null);
      if (text !== null) throw new Error(text);
    },
    "tool.execute.after": async (input, output) => {
      if (typeof input?.sessionID !== "string") return;
      counted(input);
      if (typeof output?.output !== "string") return;
      // No Even Keel, or no answer in time, must never break the tool call.
      const [note, mail, found] = await Promise.all([
        checkpointNote(input.sessionID).catch(() => null),
        mailOf(input.sessionID, "PostToolUse").catch(() => null),
        standard("after", input, input.args).catch(() => null),
      ]);
      if (found?.give !== undefined) output.output += reminder(found.give);
      if (note !== null) output.output += reminder(note);
      if (mail === null) return;
      output.output += reminder(mail);
      output.metadata = { ...(output.metadata ?? {}), evenKeel: { mail } };
    },
    // Fires for every text part, also one followed by more tool calls: the line it adds there is not the turn's last.
    "experimental.text.complete": async (input, output) => {
      if (!sinceNote.has(input?.sessionID) || typeof output?.text !== "string" || hasMark(output.text)) return;
      if (!(await noteAtEnd(input.sessionID).catch(() => false))) return;
      output.text = `${output.text.trimEnd()}\n\n${MARK}`;
    },
    event: async ({ event }) => {
      const session = event?.properties?.sessionID;
      if (event?.type === "session.compacted" && typeof session === "string") clearGiven(STATE_DIR, session);
    },
  };
};
