import { calibrationContext } from "../hooks/calibration-context.mjs";
import { marksRefusal } from "../hooks/marks.mjs";

const WRITES = /^plugin_huly_huly_(create|update|add)_/;
const keyOf = (input) => `${input.sessionID}:${input.callID}`;

// OpenCode treats every export as a plugin, so shared helpers stay in hooks/.
export const server = async () => {
  const pending = new Map();
  return {
    "tool.execute.before": async (input, output) => {
      if (!WRITES.test(input.tool)) return;
      const reason = marksRefusal(output.args);
      if (reason !== null) throw new Error(reason);
      const context = await calibrationContext(input.sessionID, input.tool, output.args).catch(() => null);
      if (context === null) return;
      if (context.refused) throw new Error(context.text);
      pending.set(keyOf(input), context.text);
    },
    "tool.execute.after": async (input, output) => {
      const key = keyOf(input);
      const text = pending.get(key);
      pending.delete(key);
      if (text === undefined) return;
      const reminder = `\n\n<system-reminder>\n${text}\n</system-reminder>`;
      // MCP calls in OpenCode 1.18.25 pass the raw result before assembling output from content.
      if (Array.isArray(output.content)) output.content.push({ type: "text", text: reminder });
      else if (typeof output.output === "string") output.output += reminder;
    },
  };
};
