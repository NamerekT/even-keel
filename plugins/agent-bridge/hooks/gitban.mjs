// Whether a shell command calls git, and what a session of a project whose git is off is told when it does.
// The agents' native deny rules match the start of a command; this finds git in any part of a compound command,
// behind a wrapper (`env`, `sudo`) and in the command line given to another shell (`bash -c "git …"`).

const SEPARATORS = /&&|\|\||[;|&\n(){}]|\$\(|`/;
const WRAPPERS = new Set(["env", "sudo", "command", "exec", "time", "nohup", "xargs", "builtin", "call", "start"]);
const SHELLS = /(^|[\\/])(ba|z|da|k)?sh(\.exe)?$|(^|[\\/])(cmd|pwsh|powershell)(\.exe)?$/i;
const RUNS_TEXT = new Set(["-c", "-lc", "-ic", "/c", "/k", "-command", "-encodedcommand"]);

const unquoted = (token) => token.replace(/^["']+|["']+$/g, "");
const isGit = (token) => /(^|[\\/])git(\.exe)?$/i.test(unquoted(token));

/** The part's words with a quoted path of several words (`"C:\Program Files\Git\cmd\git.exe"`) kept as one. */
function wordsOf(part) {
  return part.match(/"[^"]*"\S*|'[^']*'\S*|\S+/g) ?? [];
}

function partCallsGit(part) {
  const words = wordsOf(part);
  let at = 0;
  // Before the command itself: `VAR=value`, a wrapper with its options and its own assignments.
  while (at < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]) || WRAPPERS.has(words[at].toLowerCase()) || (at > 0 && words[at].startsWith("-")))) {
    // `sudo -u john`: the option's value is not the command.
    if (words[at] === "-u" || words[at] === "-g") at += 1;
    at += 1;
  }
  const command = words[at];
  if (command === undefined) return false;
  if (isGit(command)) return true;
  if (!SHELLS.test(unquoted(command))) return false;
  const text = words.findIndex((word, index) => index > at && RUNS_TEXT.has(word.toLowerCase()));
  return text >= 0 && callsGit(words.slice(text + 1).map(unquoted).join(" "));
}

/**
 * git in the place of a command anywhere in `command`: with any arguments and global options, as `git.exe` or by a
 * path. A command that only names git (`grep git`, `cat .git/config`, `echo "git status"`) is not a call.
 */
export function callsGit(command) {
  const text = String(command ?? "");
  if (!/git/i.test(text)) return false;
  // A quoted string is one word of its part, except what a shell is told to run: that is looked into by `partCallsGit`.
  const parts = [];
  let part = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      part += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      part += char;
      continue;
    }
    const found = SEPARATORS.exec(text.slice(index, index + 2));
    if (found !== null && found.index === 0) {
      parts.push(part);
      part = "";
      index += found[0].length - 1;
    } else part += char;
  }
  parts.push(part);
  return parts.some(partCallsGit);
}

export const REFUSAL =
  "Even Keel: git is turned off for this project, so this call did not run. " +
  "The project's folder is not a repository of its own: do the task without git, and do not retry it through another shell or a script.";

/**
 * The refusal text for `command` in a session of a project whose git is off, or null: no git in it, the project has
 * git, or Even Keel did not answer. `checkOf` asks Even Keel only for a command that calls git.
 */
export async function gitRefusal(command, checkOf) {
  if (!callsGit(command)) return null;
  const check = await Promise.resolve()
    .then(checkOf)
    .catch(() => null);
  return check?.git === false ? REFUSAL : null;
}
