# Limit answers of plans we have no account for

Samples of the subscription limit answers of plans the author does not have (EKR-41). How such answers are found and how a sample is made from one is in [`docs/sessions/limits.md`](../../../docs/sessions/limits.md), "Answers of plans we have no account for". In short: each file is written by us in the shape of a public answer, not copied; ids, emails and tokens are left out, the values and reset times are made up (January 2030), and a field the source cut out (`...`) is left out rather than invented.

| File | Plan and answer | Seen | Sources |
| --- | --- | --- | --- |
| `chatgpt-pro-wham-usage.json` | ChatGPT Pro, `wham/usage` | 2026-10-23 | [quotadial fixture](https://github.com/pghmatt/quotadial/blob/9937c3e3f73d8eba6fb5c5f7a8f5732185a4f655/fixtures/codex/wham-usage.json), [cockpit-tools#2898](https://github.com/jlcodes99/cockpit-tools/issues/2898) |
| `claude-max-oauth-usage.json` | Claude Max, `/api/oauth/usage` | 2026-07-25, 2026-08-14 | [claude-statusline#5](https://github.com/JungHoonGhae/claude-statusline/issues/5), [claude-code-statusline#4](https://github.com/ohugonnot/claude-code-statusline/issues/4) (Claude Code 2.1.220) |
| `claude-ultra-oauth-usage.json` | Claude Ultra, verified account, `/api/oauth/usage` | 2026-10-30, 2026-11-01 | [claude-dashboard#113](https://github.com/uppinote20/claude-dashboard/issues/113), [anthropic-auth#572](https://github.com/cortexkit/anthropic-auth/issues/572) |
| `claude-team-oauth-usage.json` | Claude Team/Enterprise seat, `/api/oauth/usage` | 2026-10-18 | [claude-swap#476](https://github.com/realiti4/claude-swap/issues/476) |
| `codex-429-plus-premium.json` | ChatGPT Plus, the Codex backend's 429 with `premium` as the active limit: headers and body | 2026-10-30 | [openai/codex#58413](https://github.com/openai/codex/issues/58413) (codex 0.165.0) |

## What each sample holds

- **OpenCode Go** — `opencode-go-200.json` has `usage.rolling`, `weekly`, `monthly` in the shape of the MIT [t3code reader](https://github.com/pingdotgg/t3code/blob/main/packages/provider-opencode/src/server/usageLimits.ts), consulted 2026-11-11; values and dates are synthetic, and `0.5` deliberately stays 0.5 percent until the scale is verified live. `opencode-go-401.json` follows the `authentication_error` / `api_key_expired` shape reported in [t3code#21625](https://github.com/pingdotgg/t3code/issues/21625), with a made-up message. `opencode-go-403.json` is `{}`: the reader documents the status as no Go subscription but no body, so no body fields are invented. Status comes from the file name. `src/opencode/go.test.ts` reads all three. The three windows are described in [Go's documentation](https://opencode.ai/docs/go/); the relative reset text comes from [opencode#49170](https://github.com/anomalyco/opencode/issues/49170).

- **ChatGPT Pro** — one weekly window in `primary_window` (`limit_window_seconds: 604800`), `secondary_window: null`: Pro has no five-hour window. The source's `user_id`, `account_id` and `email` are left out.
- **Claude Max** — `five_hour` and `seven_day` filled, `seven_day_opus`, `seven_day_sonnet` and `seven_day_cowork` `null`; the model's week is the `weekly_scoped` entry of `limits[]` (`scope.model.display_name: "Fable"`), with `severity` and `is_active`. Both sources cut out `resets_at` of the `limits[]` entries, so they have none here; other top-level keys of the answer were omitted in the sources too.
- **Claude Ultra** — `"five_hour": null` and no `session` entry in `limits[]`: a verified Ultra account has no five-hour limit. `seven_day` has the dollar fields the source shows. The sources show only `kind`, `percent` and the model of the `limits[]` entries, so `group`, `severity`, `is_active` and `resets_at` are absent; the top-level `seven_day_*` keys were not shown.
- **Claude Team/Enterprise** — `"seven_day": null`; `limits[]` has `session` and `weekly_scoped`, no `weekly_all`. The source shows only these two keys: `five_hour` and the entries' `resets_at` are absent.
- **Codex 429** — `status`, `headers` and `body` of one answer. `X-Codex-Active-Limit: premium` names a limit that has no headers of its own, while the full `X-Codex-Primary-*` (100 %, 300 minutes) and `X-Codex-Secondary-*` (53 %, 10080 minutes) families are there. codex 0.165 reads only the active family and writes an empty `premium` snapshot into the rollout's `token_count` (EKR-30); its turn ends with the usage limit.

## Who reads them

- `src/limits/chatgpt.test.ts` — the Pro sample through `chatGptLimits`.
- `src/codex/rollout.test.ts` — the 429 body as the error of a failed turn.
- `src/limits/usage.test.ts` — the `limits[]` of the three Claude samples through `modelWeeksOf`, alone and as the `usage_report` of a `/usage` stream: Even Keel does not ask `/api/oauth/usage` itself, but the CLI's `/usage` message carries the same rows (BTN-805).
