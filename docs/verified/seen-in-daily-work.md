# What has been verified: Seen in daily work

One area of [What has been verified](../verified.md), whose head says how a row reads and where a new one goes.

What runs every day was never checked in a session of its own and has no commit. These rows are counts from the service log (`logs/even-keel.log`, 2026-10-04 to 2026-10-27) of the author's workstation; a launch is a log line "started in the session". Only behaviour that `unverified.md` or the area's document names is counted here. The counts are of the log's own lines.

| Behaviour | Where | Seen | Count | Result |
| --- | --- | --- | --- | --- |
| A chain starts a session on the first open task of a project and goes on to the next | the service on the author's workstation, chains of Huly, GitHub, Linear and GitLab projects | 2026-10-10 to 2026-10-27 | 507 launches, 15–63 a day | whole; five launches refused ("could not start", "did not show up in `claude agents`"), the one after 2026-10-24 for a sandbox folder not yet trusted |
| A task's branch landing in the project's branch closes the task in the tracker | same | 2026-10-04 to 2026-10-27 | 239 closes: 195 Huly (`BTN`, `EKR` and others), 13 a second Huly profile, 10 a local GitLab, 8 Linear, 5 GitLab.com | whole |
| A session answered by the page's chat: the answer reaches the waiting session by `--resume` | same | 2026-10-12 to 2026-10-27 | 109 resumes with an answer, 101 answers from the page, 5 from a tracker comment and 67 "resumed in N ms" lines | whole |
| A chat message to a working session waits in its mailbox and the hook takes it | same | 2026-10-18 to 2026-10-26 | 36 messages in a mailbox; the hook took them on `PreToolUse` 18 times, `PostToolUse` 11, `Stop` 2 | whole |
| A handoff by `CHECKPOINT:` to a new session | same | 2026-10-10 to 2026-10-22 | 130 handovers by checkpoint, 17 by relay, 15 by restart, 2 by resume; none by checkpoint after 2026-10-22, since the thresholds were raised for the auto-compact experiment | whole for the days it was on |
| A task with nothing to merge ends by `NO CHANGES:` | same | to 2026-10-27 | 12 tasks (7 on `dev`, 5 on `main`) | whole |
| A release project's carry into `dev` after a task | same | to 2026-10-27 | 7 carries of the release's commits by the chain's `EKR-CARRY` | whole |
| A pull request or merge request opened for a task in PR mode | same, Forgejo and GitLab sandboxes | to 2026-10-27 | 24 opened (9 Forgejo, 15 GitLab); 5 restarts of a chain on feedback | whole |
| The service's restart (update, rebuild, a crash of the host) | same | 2026-10-04 to 2026-10-27 | 569 starts, up to 64 a day | whole as a start; whether the sessions lived through each is in the rows of Sessions |
| Chain sessions on Even Keel's own copy of the Claude Code CLI (`cli.claude: checked`, row 8 of "What to check first") | same | 2026-10-24 20:42 to 2026-10-27 | 126 launches and 96 task closes from the copy of 2.1.310, no failure of the CLI; passive, so the row stays open for a new version | whole for 2.1.310; each later version needs its own `cli-check` |
