import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeRefusal, mergesBranch, refusal, runCommand } from "./merges.mjs";

const node = (code) => `node -e "${code}"`;

/** A repository whose checkout is on the task branch `abc-12/task`, as a task's worktree is. */
function taskRepo() {
  const dir = mkdtempSync(join(tmpdir(), "merge-check-"));
  execFileSync("git", ["init", "-q", "-b", "abc-12/task"], { cwd: dir });
  return dir;
}

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

describe("runCommand", () => {
  it("gives the command's code and its output, both streams", async () => {
    expect(await runCommand(node("console.log('ok')"), tmpdir())).toEqual({ code: 0, output: expect.stringContaining("ok") });
    const failed = await runCommand(node("console.error('broken'); process.exit(3)"), tmpdir());
    expect(failed).toEqual({ code: 3, output: expect.stringContaining("broken") });
  });

  it("kills a command over the time limit and counts it as failed", async () => {
    const started = Date.now();
    const run = await runCommand(node("setTimeout(() => {}, 30000)"), tmpdir(), 500);
    expect(run.code).toBe(-1);
    expect(run.output).toContain("Timed out");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("mergeRefusal", () => {
  let repo;
  beforeAll(() => {
    repo = taskRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const merge = 'git -C "D:/repos/app" merge --no-edit abc-12/task';
  const checkOf = (commands, main = "main") => async () => ({ commands, main });

  it("runs the check in the worktree and refuses the merge with the first failed command", async () => {
    const text = await mergeRefusal(merge, repo, checkOf([node("process.exit(0)"), node("console.log('red'); process.exit(4)"), node("process.exit(5)")]));
    expect(text).toContain("exited with code 4");
    expect(text).toContain("red");
  });

  it("lets the merge go when the check passes, there is none or the branch is main", async () => {
    expect(await mergeRefusal(merge, repo, checkOf([node("process.exit(0)")]))).toBeNull();
    expect(await mergeRefusal(merge, repo, checkOf([]))).toBeNull();
    expect(await mergeRefusal(merge, repo, checkOf([node("process.exit(1)")], "abc-12/task"))).toBeNull();
  });

  it("asks Even Keel nothing for other commands, outside git, and lets the merge go when it does not answer", async () => {
    const never = () => {
      throw new Error("asked");
    };
    expect(await mergeRefusal("git merge main", repo, never)).toBeNull();
    expect(await mergeRefusal("npm test", repo, never)).toBeNull();
    expect(await mergeRefusal(merge, tmpdir(), never)).toBeNull();
    expect(await mergeRefusal(merge, repo, () => Promise.reject(new Error("refused")))).toBeNull();
  });
});
