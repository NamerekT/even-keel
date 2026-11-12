import { describe, expect, it } from "vitest";
import { callsGit, gitRefusal } from "./gitban.mjs";

describe("callsGit", () => {
  it("knows git with any arguments and global options, by any name of its binary", () => {
    for (const command of [
      "git",
      "git status",
      "git -C x status",
      "git --no-pager log",
      "git -c core.x=y --git-dir=.git commit -m x",
      "git.exe status",
      "GIT.EXE status",
      "/usr/bin/git status",
      '"C:\\Program Files\\Git\\cmd\\git.exe" status',
      "& 'C:\\Program Files\\Git\\cmd\\git.exe' status",
    ]) {
      expect(callsGit(command), command).toBe(true);
    }
  });

  it("finds git in any part of a compound command", () => {
    for (const command of [
      "cd sub && git status",
      "npm test; git add -A",
      "npm test || git stash",
      "ls | git hash-object --stdin",
      "echo start\ngit log",
      "echo $(git rev-parse HEAD)",
      "echo `git rev-parse HEAD`",
      "(cd sub; git status)",
      "if ($true) { git status }",
      "npm test & git status",
    ]) {
      expect(callsGit(command), command).toBe(true);
    }
  });

  it("finds git behind a wrapper, a variable assignment or another shell", () => {
    for (const command of [
      "env git status",
      "GIT_PAGER=cat git log",
      "env GIT_DIR=.git git log",
      "sudo -u john git status",
      "command git status",
      "exec git status",
      "time git status",
      "nohup git gc",
      "xargs git add",
      'bash -c "git status"',
      "sh -lc 'git status'",
      "cmd /c git status",
      'pwsh -NoProfile -Command "git status"',
      "powershell -Command git status",
      "bash -c 'cd sub && git status'",
    ]) {
      expect(callsGit(command), command).toBe(true);
    }
  });

  it("leaves alone a command that only names git", () => {
    for (const command of [
      "",
      "grep -r git .",
      "echo git",
      'echo "git status"',
      "cat .git/config",
      "ls .git",
      "gitk",
      "github-cli status",
      "npm run git",
      "rg --files -g !.git",
      "node scripts/git.js",
      'bash -c "echo git"',
      "Get-ChildItem git",
    ]) {
      expect(callsGit(command), command).toBe(false);
    }
    expect(callsGit(undefined)).toBe(false);
  });
});

describe("gitRefusal", () => {
  const off = async () => ({ git: false });
  const on = async () => ({ git: true });

  it("refuses a git call in a project whose git is off and says why", async () => {
    expect(await gitRefusal("cd sub && git status", off)).toMatch(/git is turned off for this project/);
  });

  it("lets git go in a project with git, and when Even Keel does not answer", async () => {
    expect(await gitRefusal("git status", on)).toBeNull();
    expect(
      await gitRefusal("git status", async () => {
        throw new Error("down");
      }),
    ).toBeNull();
  });

  it("does not ask Even Keel about a command without git", async () => {
    let asked = 0;
    const count = async () => {
      asked += 1;
      return { git: false };
    };
    expect(await gitRefusal("npm test", count)).toBeNull();
    expect(await gitRefusal("cat .git/config", count)).toBeNull();
    expect(asked).toBe(0);
  });
});
