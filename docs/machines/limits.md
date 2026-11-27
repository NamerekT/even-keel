# Account limits across machines

BTN-991: the hub holds the picture of each claude.ai account's limits, and one place polls `/usage` per account, so two machines signed in to one account do not both poll its token (`docs/sessions/limits.md`; whether a 429 counts per token or per account does not matter then). Codex, OpenCode and Copilot folders are not in it: each machine polls them itself.

## The account and its poller

- **The account** of a Claude folder is `oauthAccount.accountUuid` of the `.claude.json` the CLI reads with it (`AccountIdentities`, `src/limits/identity.ts`, read again at most every 30 s). The machine posts it in the facts' `identities` section by folder (`AccountTie`): the account, its e-mail, whether its watcher could poll the folder (`LimitsWatcher.pollable`: a full sign-in, not a long token, not an API key) and whether it skips it now.
- **A long-token folder** has no `oauthAccount`: it is posted under the hub's account its token was said to be of (`LongToken.account`, BTN-1002; `accountTie`), never as a poller, so it gets the poller's limits in `picture` and its sessions' windows reach the account's other machines. An account only long tokens are signed in to has no poller: each machine knows it from its sessions alone.
- **The poller** (`AccountPolls`, `src/limits/polls.ts`) is chosen among the machines on the link whose folder of the account could be polled, the first that fits:
  - the hub's own machine whenever it is one of them;
  - the machine named before, while it stays on the link;
  - the first by id, with a line in the log.
- A machine that went off the link gives the account to another. An account none can poll has no poller and nobody skips it.
- **One account on two machines** — the hub logs once that they share one limit window, and `AccountPolls.shared()` lists them for the page of machines (BTN-993).

## The plan

- **The command** `limits.plan` (`LimitsPlan`): `skip` — the folders whose account another machine polls, sent whole when it changes; `picture` — by folder, the newest limits another machine posted of the folder's account, sent once per time and only when newer than what the machine itself posted, so a picture handed over and posted back is no news.
- **When.** The hub works it out at every change of the mirror and at a machine's going offline; a new connection forgets what the machine was told, and the first plan of every machine but the hub's own carries `skip`, an empty list too (BTN-1247), so a machine elsewhere always gets the plan it waits for. A command that fails makes the hub tell everything again. The hub plans its accounts with the own machine's (`MachineNetwork.accounts()` in `steerLimits`) and sends each machine elsewhere's plan through its own `RemoteMachine` (`tellLimits`).
- **On the machine** `LimitsWatcher.plan` keeps the skip list and the handed limits (`hub`, newest of all sources as any other): a skipped folder is not polled, its chain does not wait for a first poll of it (`unread`), and its health is "ok". A folder given back is polled no sooner than a poll interval later: its poller may just have polled it. Handed limits are not saved to `account_limits`; the hub hands them again after a restart.
- **A machine elsewhere** (BTN-1247) starts its watcher with `planFirst`: no round of polls before the hub's first `limits.plan`, or it might poll what another machine polls. Off the link it keeps the plan it had: it takes a limit from the session's refusal and does not start polling an account another machine polls.
- **With one machine** the hub's own machine polls every account and nothing is ever sent: behaviour does not change.

## Long tokens' limits

- **Limits from sessions only** (BTN-1266). A machine's long-token folder whose account has no poller (`AccountPolls.poller`, handed in as `polled`) — or, with no account known, no `sameAs` folder on a full sign-in in its panel — is `MachineAccount.sessionsOnly` (`sessionsOnly` in `src/service/machine-page.ts`), in `machineSignIns` (and in the machine page's query, which the page no longer reads). The page marks it "limits from sessions only", the tip the notice `usage.sessionsOnly`:
  - under the hub's account row in the machine's line (`machineTokens`, the hub's folder signed out too — its "Sign in" is the fix);
  - under the folder's row on the machine's accounts page (`/accounts?machine=`, `MachineTokenNote` from `machineAccountView`'s `tokens`, BTN-1740), tagged "long token", with "Sign in fully" (`fullSignIn`: again in the hub's Claude folder of the e-mail, else a new one);
  - a hub long-token row gets the same line with "Sign in fully" while no Claude folder of the hub is on a full sign-in (`hubSessionsOnly`): such a token names no account, so a full sign-in of another one also takes the mark off.
- The key on a machine's label for a long token is another mark ("A long token", `machine-side.md`).
- **A token's windows against the poll** (BTN-1267). At each plan the hub compares what a long-token folder's own sessions told (`polls: false`, `source: 'sdk'`; the poll it was handed and posts back is no evidence) with the newest poll (`source: 'usage'`) of a full sign-in of the same account (`tokenWindowsDiffer`, `src/limits/token-windows.ts`): a five hours or a week whose reset stands more than an hour off (`/usage` names it to the hour), or whose later reading spent over 5 points less than the earlier one, while neither window had ended before the other reading.
  - Then the account is `AccountPolls.differs`: a line in the log names the window, the machines and that the full sign-in's poll is taken, and `newestElsewhere` stops handing the token folders' session windows to other machines, so the hub's picture does not swing between the two; a later pair that agrees takes it back, with a line.
  - The machine's accounts page marks such a folder under its row "limits differ from the hub's" (`MachineAccount.limitsDiffer`, `MachineTokenNote`), the notice `usage.tokenWindowsDiffer` in its tip, and "New token" next to it, while the machine is online, opens the token window for the hub's full sign-in of the e-mail. `dev:fake`: `/accounts?machines=tokenDiffer&machine=machine-2`.
