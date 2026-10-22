// The checkpoint package's hooks for OpenCode, whose hooks are JS plugins run inside its own process: Even Keel
// loads every script of this folder into a chain session's config. After each tool call the plugin asks Even Keel
// what the hook commands of Claude Code and Codex ask (../hooks/evenkeel.mjs) — the checkpoint nudge due and the
// chat's waiting messages — and puts them after the tool's output, the only way into the context in the middle of
// a turn. A delivered message is also kept in the call's metadata, where Even Keel's feed finds it. A subagent runs
// in a session of its own, which Even Keel does not know, so it is left alone. Only `server` is exported: OpenCode
// takes the module's exports for plugins.
import { checkpointNote, mailOf } from "../hooks/evenkeel.mjs";

const reminder = (text) => `\n\n<system-reminder>\n${text}\n</system-reminder>`;

export const server = async () => ({
  "tool.execute.after": async (input, output) => {
    if (typeof input?.sessionID !== "string" || typeof output?.output !== "string") return;
    // No Even Keel, or no answer in time, must never break the tool call.
    const [note, mail] = await Promise.all([
      checkpointNote(input.sessionID).catch(() => null),
      mailOf(input.sessionID, "PostToolUse").catch(() => null),
    ]);
    if (note !== null) output.output += reminder(note);
    if (mail === null) return;
    output.output += reminder(mail);
    output.metadata = { ...(output.metadata ?? {}), evenKeel: { mail } };
  },
});
