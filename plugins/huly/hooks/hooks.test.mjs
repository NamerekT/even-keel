import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const run = (script, input) => spawnSync(process.execPath, [join(HOOKS, script)], { input: JSON.stringify(input), encoding: "utf8" });

/** A PreToolUse of the gateway's Huly server as each agent sends it (Claude Code 2.1, Codex 0.162.1). */
const agents = {
  claude: (tool_input) => ({
    session_id: "s-1",
    cwd: "D:\\repo",
    hook_event_name: "PreToolUse",
    tool_name: "mcp__plugin_huly_huly__update_issue",
    tool_input,
  }),
  codex: (tool_input) => ({
    session_id: "019a0000-0000-7000-8000-000000000000",
    turn_id: "turn-1",
    cwd: "D:\\repo",
    hook_event_name: "PreToolUse",
    model: "gpt-6-luna",
    tool_name: "mcp__plugin_huly_huly__update_issue",
    tool_input,
  }),
};

describe.each(Object.entries(agents))("check-marks on %s input", (_agent, input) => {
  it("denies inline code inside marks with the offending fragments", () => {
    const refused = run("check-marks.mjs", input({ project: "ABC", identifier: "ABC-1", description: "**see `Core`** and ~~use `Old`~~" }));
    expect(refused.status).toBe(0);
    expect(refused.stderr).toBe("");
    expect(JSON.parse(refused.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringMatching(/Not sent/),
      },
    });
    const reason = JSON.parse(refused.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("- **see `Core`**");
    expect(reason).toContain("- ~~use `Old`~~");
    expect(reason).toContain("Move the code outside the mark");
  });

  it("lets clean markdown through without output", () => {
    const allowed = run("check-marks.mjs", input({ project: "ABC", identifier: "ABC-1", description: "**see** `Core`" }));
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toBe("");
    expect(allowed.stderr).toBe("");
  });
});
