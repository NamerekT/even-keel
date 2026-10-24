// Whether a Bash command merges the session's task branch, which in a chain session is its merge into main,
// the project's check run before that merge, and what the session is told when the check stops it.
import { execFile, spawn } from "node:child_process";
import { standardsRefusal } from "./standards.mjs";

const COMMAND_TIMEOUT_MS = 20 * 60_000;
const OUTPUT_CHARS = 1024 * 1024;
const PARTS = /&&|\|\||[;|\n]/;
const CONTROL = new Set(["--abort", "--continue", "--quit", "--skip"]);
export const OUTPUT_LINES = 60;

function tokensOf(part) {
  return part
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""));
}

const isGit = (token) => /(^|[\\/])git(\.exe)?$/i.test(token);

/** `git … merge … <branch>` in one part of the command; `merge-base`, `--abort` and other branches do not count. */
export function mergesBranch(command, branch) {
  if (!branch) return false;
  return String(command ?? "")
    .split(PARTS)
    .some((part) => {
      const tokens = tokensOf(part);
      const git = tokens.findIndex(isGit);
      if (git < 0) return false;
      const merge = tokens.indexOf("merge", git + 1);
      if (merge < 0) return false;
      const rest = tokens.slice(merge + 1);
      return rest.some((token) => token === branch || token.endsWith(`/${branch}`)) && !rest.some((token) => CONTROL.has(token));
    });
}

/** The text that sends the session back: the failed command, its code and the tail of its output. */
export function refusal(command, code, output) {
  const lines = String(output ?? "").split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  return (
    `Even Keel's check before the merge failed: \`${command}\` exited with code ${code} in the task's worktree. ` +
    "The merge did not run. Fix the cause, commit, and merge again.\n\n" +
    lines.slice(-OUTPUT_LINES).join("\n") +
    "\n"
  );
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout) => resolve(error ? "" : stdout.trim()));
  });
}

/**
 * One command of the check in a shell, without blocking the process that waits on it: OpenCode runs its plugins in its
 * own. A command over the time limit is killed with its children and counts as failed.
 */
export function runCommand(command, cwd, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let output = "";
    const keep = (chunk) => {
      output = (output + chunk).slice(-OUTPUT_CHARS);
    };
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGKILL");
      resolve({ code: -1, output: `${output}\nTimed out after ${Math.round(timeoutMs / 60_000)} min.` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", keep);
    child.stderr.setEncoding("utf8").on("data", keep);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

/**
 * What stops `command` when it merges the task branch of the worktree at `cwd` and the project's check fails, or the
 * check of a standard whose files the branch changed is not done (`standardsRefusal`): the refusal text, or null — no
 * such merge, no check, or every command passed. `checkOf` asks Even Keel; when it fails, the merge goes on.
 */
export async function mergeRefusal(command, cwd, checkOf) {
  if (!String(command ?? "").includes("merge")) return null;
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = root === "" ? "" : await git(root, ["branch", "--show-current"]);
  if (branch === "" || !mergesBranch(command, branch)) return null;
  const check = await checkOf().catch(() => null);
  if (check === null || branch === check.main) return null;
  const standards = await standardsRefusal(root, check.main, check.standards);
  if (standards !== null) return standards;
  for (const step of check.commands) {
    const run = await runCommand(step, root);
    if (run.code !== 0) return refusal(step, run.code, run.output);
  }
  return null;
}
