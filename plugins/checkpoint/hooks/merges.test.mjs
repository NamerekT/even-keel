import { describe, expect, it } from "vitest";
import { mergesBranch, refusal, mergeRefusal } from "./merges.mjs";

const branch = "abc-12/task";

describe("mergesBranch", () => {
  it("sees the merge of the task branch however the command reaches the main checkout", () => {
    expect(mergesBranch("git merge --no-edit abc-12/task", branch)).toBe(true);
    expect(mergesBranch('cd "D:/repos/app" && git merge --no-edit abc-12/task', branch)).toBe(true);
    expect(mergesBranch("git -C D:/repos/app merge --no-edit 'abc-12/task' 2>&1 | tail -5", branch)).toBe(true);
    expect(mergesBranch("git merge refs/heads/abc-12/task", branch)).toBe(true);
  });

  it("leaves other merges and git commands alone", () => {
    expect(mergesBranch("git merge main", branch)).toBe(false);
    expect(mergesBranch("git merge --abort", branch)).toBe(false);
    expect(mergesBranch("git merge --abort abc-12/task", branch)).toBe(false);
    expect(mergesBranch("git merge-base main abc-12/task", branch)).toBe(false);
    expect(mergesBranch("git log abc-12/task; echo merge", branch)).toBe(false);
    expect(mergesBranch("git merge --no-edit abc-120/task", branch)).toBe(false);
    expect(mergesBranch("git merge abc-12/task", "")).toBe(false);
    expect(mergesBranch(undefined, branch)).toBe(false);
  });
});

describe("refusal", () => {
  it("denies the call explicitly, including Codex nested shell calls that ignore exit code 2", () => {
    expect(mergeRefusal("npm test", 1, "failed")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: refusal("npm test", 1, "failed"),
      },
    });
  });

  it("names the command and its code and keeps the tail of the output", () => {
    const output = [...Array.from({ length: 80 }, (_, i) => `line ${i}`), "", ""].join("\r\n");
    const text = refusal("npm test", 1, output);
    expect(text).toContain("`npm test` exited with code 1");
    expect(text).toContain("The merge did not run.");
    expect(text).toContain("line 79");
    expect(text).not.toContain("line 19\n");
    expect(text.trimEnd().endsWith("line 79")).toBe(true);
  });
});
