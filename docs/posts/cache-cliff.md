# The cache cliff on a subscription sits at an hour, not five minutes

Numbers from Tally over 2026-09-01 .. 2026-11-17 13:00 UTC; every query is in [cache-cliff.sql](cache-cliff.sql).

## TL;DR

An analysis of Claude Code usage ([inevolin/claude-code-usage-analysis](https://github.com/inevolin/claude-code-usage-analysis)) found that coming back to a session after a pause of over five minutes costs about 10x a warm turn: the prompt cache has expired and the whole context is written into it again. That holds on an API key, whose cache lives five minutes. On a Pro or Max subscription Claude Code writes the one-hour cache (99.8 % of all cache writes here), so the cliff moves to an hour, and over two and a half months the turns after it cost 0.22 % of the spend of sessions run by hand and 0.04 % of the chain's.

## Setup

- Every Claude response of the main thread (no subagents) of Claude Code sessions: the CLI, the VS Code extension, the desktop app and the chain's Agent SDK sessions, all on Pro subscriptions.
- Only responses with more than 20k tokens of context: below that a rebuild costs too little to matter.
- The pause is the time since the session's previous response. A rebuild is a response that wrote more than half of its context into the cache instead of reading it.
- Cost is in list-price units relative to input: input 1, five-minute cache write 1.25, one-hour write 2, cache read 0.1. "Warm" is the same response with every write counted as a read.

## The cliff

| Pause | Responses | Rebuilt | Avg context | A rebuild costs |
| --- | ---: | ---: | ---: | ---: |
| under 5 min | 184,023 | 0.2 % | 121k | 14.3x |
| 5–30 min | 2,267 | 1.8 % | 120k | 14.8x |
| 30–55 min | 147 | 0.7 % | 121k | 14.7x |
| 55–65 min | 18 | 11 % | 92k | 16.2x |
| 65–120 min | 13 | 77 % | 84k | 16.4x |
| 2h+ | 11 | 91 % | 101k | 15.0x |

Rebuilds under an hour are most likely compactions, model switches and the like, not an expired cache (not checked one by one). Past an hour three responses in four rebuild, and each costs 14–16x a warm one, close to the 10x of the API-key measurement plus the dearer one-hour write.

## What it cost

| Sessions | 1-hour writes | Extra spend after a 55+ min pause |
| --- | ---: | ---: |
| by hand | 99.8 % | 0.22 % |
| the chain | 99.9 % | 0.04 % |

The chain has almost no long pauses: it waits on the user only for a question. Sessions by hand do, but rarely enough that the cliff is a rounding error.

## Caveats

- One user, one workflow; a person who leaves sessions open over lunch and comes back to them will see a bigger share.
- The pause buckets past 55 minutes hold 42 responses in all: the shape of the cliff is clear, its exact percentages are not.
- Tally sees what the transcripts record; a session whose transcript was lost is not in the sample.
