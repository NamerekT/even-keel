// Whether a Bash command merges the session's task branch, which in a chain session is its merge into main,
// and what the session is told when the project's check stops that merge.

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
