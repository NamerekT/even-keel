# tally

A session audit over Even Keel's stats. Tally, the collector built into Even Keel, keeps the numbers of every session — spend, context, time, stuck spans, handoffs, rule edits — and the `/stats` page shows them; the `tally:session-audit` skill turns them into an answer. Ask a session "tasks got more expensive this week — why?" or "what changed after I edited CLAUDE.md?", and it:

- picks the periods: the one you name, or "now" since the project's last rule edit against a span of the same length before it (the last 7 days against the 7 before them when an edit has too little data after it);
- compares them on the metrics the complaint calls for — task cost and time, context per request, the share of requests over 150k, entry context, sessions per task, stuck spans, tool errors, estimates against actual time — always cut by model, so cheap models taking the small tasks do not pass for savings;
- lists what changed between them: rule edits with their logged reasons, models, the mix of tasks, an outlier task shown apart;
- digs into the 2–5 tasks that show the cause, and into handoffs and context compactions: what the next session re-read, what the ramp-up cost, what the note did not carry;
- ends with proposals in order of usefulness, each with the metric it should move. It changes no rule by itself.

It only reads: a read-only transaction, no collector run.

## Requirements

Even Keel with stats switched on (Settings → Stats), and some days of sessions collected. The estimates, statuses, components and labels come from Huly; with another tracker the audit skips the parts that need them and says so.

## Install

In Claude Code, from any project — the audit is something you ask for, so install it where you work, not as a package of a chain:

```
claude plugin marketplace add /path/to/even-keel
claude plugin install tally@even-keel
```

Even Keel's `/tools` page offers the first command too ("Add to Claude Code"). To give it to chain sessions as well, add it on `/tools` like any package.

## Where the data is

The skill runs `bin/sql.mjs` of this plugin, which runs Tally's query script `tally/bin/sql.mjs` of Even Keel's checkout (it needs that checkout's `node_modules` and `.env`). The checkout is found by, in order:

| | |
| --- | --- |
| `EVEN_KEEL_HOME` | the checkout's folder, if set |
| the folders above the plugin | a copy Even Keel made in its own `state/`, or the source in `plugins/` |
| `EVEN_KEEL_URL` | the running Even Keel names its checkout (by default `http://127.0.0.1:4747`) |

The database is the one Even Keel's stats use: the embedded one through the running service, or your own Postgres as the `tally_reader` role when `TALLY_DB_*` are in Even Keel's `.env`.

## Caveats

Money is at API prices (`prices` in `tally/tally.config.json`): a ruler to compare periods with, not your subscription's bill. Task statuses and labels are refreshed hourly, sessions every five minutes.
