# The chat: calls, pictures and files

How the feed draws a session's calls, a context compaction, the pictures and videos of the transcript and the files a session sends. The field under the feed is in `composer.md`.

## Calls in the chat

BTN-185, read like Claude Code: the text comes first and the calls between two texts fold into one line, "Edited 2 files, read a file, ran 2 commands +31 −4 (1 failed) ›" (`feedEntries`, `summarize` and `toolKind` in `web/src/pages/toolGroups.ts`).

- **Breaks.** A question breaks a group, a pause of over 5 minutes gets a time mark across the column, and a lone call stands as its own row.
- **The open group** is a list of `CallRow`s (`web/src/pages/ToolCalls.tsx`): the verb and the subject — the file name with its path in a tip, a command's description, a search's pattern — and a call with a command or an error opens under itself to show it; mono is only there.
- **What the fold gives.** A tool line gets its `name`, `subject` (`subjectOf`) and, for an edit, `added`/`removed` (`callFacts` in `src/sessions/transcript.ts`), and after a result with `is_error` a `failed` line with the error, which the page folds into its call as a red "failed". Codex does the same from the rollout (`status: 'failed'`, a `FileChange`'s `content` or `unified_diff`, `docs/unverified.md`).
- **dev:fake**: the chat of ABC-5 has a long run of calls with edits and a failed command (`fakeCalls`).

## A context compaction

BTN-1703: a divider across the column, not the user's message — a wave at each side of a quiet caption with `CompactIcon`, "Context compacted, saved 199.3k tokens" (`.transcript__compact`, `t.session.compactLine`, `formatSavedTokens`), with a comma where Claude's app has " · " (`docs/design.md`, "Facts are never glued").

- **Claude**: `compact_boundary` gives a `compact` feed line with `saved` = `preTokens − postTokens` from its `compactMetadata`, no number without both; the summary the CLI writes next as a `user` row with `isCompactSummary` stays out of the feed, readable only in the transcript file. `/compact` looks the same.
- **Codex**: its `compacted` line gives the divider without a number.
- The panel's activity feed shows the same caption, muted. The session's compaction count and its badge are unchanged.

## Pictures in the transcript

BTN-184, BTN-396.

### Where they come from

- **In the transcript.** Claude keeps a picture of a tool result whole, base64 in an `image` block of the `tool_result` (`docs/verified/sessions.md`); Codex keeps `input_image` data URLs in its rollout's tool outputs (`docs/sessions/codex.md`, "Codex"); OpenCode keeps image attachments in `opencode.db` (BTN-481: its whole fold emits `image` lines from their count, its `Agent.image` reads the selected base64 attachment by session and call id, `sessionImage`, `docs/sessions/opencode.md`, "OpenCode").
- **The `image` line.** The whole fold gives tool lines the call's id (`FeedLine.tool`) and, after a result with pictures, an `image` line with the call's id, their count and, for a `Read` or a statically named `view_image`, the file name; the data never goes into the state, SSE or the lines. It is a line of its own, not a mark on the tool line, because the page reads lines once and the result comes after the call.
- **A session's picture**: `GET /api/sessions/<id>/images/<tool>/<n>` decodes it from the transcript (the optional `Agent.image`: Claude's `readTranscriptImage`, Codex's `readRolloutImage`), even after the original file and the worktree are gone.
- **A picture the user sent**: `GET /api/sessions/<id>/files/<name>` gives one the transcript names inside `.temp/inbox/` (`inboxImage`), else one in `.temp/inbox/` of the session's own folder (the record's `workdir`, `inboxImageIn`), before the transcript names it — a bare name `inboxName` leaves as it is and a picture type only, so no other folder is reached (BTN-1360) — and 404 once the worktree is cleaned up.

### Thumbnails

- **Beside the call.** `TranscriptWindow` puts the thumbnails (`Thumbs`) right of a matching tool line, or on their own when the call has no tool line; a row that does not fit beside the line's text wraps under it, never squeezing the text or the edit size (BTN-1103).
- **A stack.** A folded group of calls with two pictures or more shows them as one stack (`ThumbStack`): the first on top and the stepped edges of at most two more, no count drawn, the click opens the viewer on the first, and `aria-label` names it and the total; a picture that will not load leaves the stack, one left is a plain thumbnail, none — nothing. The opened group shows each picture at its call.
- **Retries.** A missing inbox image is retried with increasing delays, because a new message may reach the page before its file appears in the transcript. Any other picture the user sent shows its 📎 name until the thumbnail loads. Pressing either opens the viewer.

### A picture the user sent

- **At once from the browser.** It shows from the chosen file (`useLocalPictures`: object URLs of the window, revoked when it closes, turns to another session or the send fails; a new project chat's first session is no other session, as its start may take minutes after the message went out, BTN-1387), and keeps that address at every stage after — the transcript has the reply, the agent read it — since the same bytes under a new address would load again and blink (BTN-1425).
- **Without the browser's copy** (the chat opened on another device) the address turns — the service's copy, then the transcript's — and each turn keeps the picture on screen until the next address has loaded unseen under it, in the bubble (`InboxThumb`, `.thumb__next`) as in the viewer (`.viewer__next`, a picture of the same name only; a neighbour shows at once), and for good when that one fails, so delivery draws no chip for a moment (BTN-1390, BTN-1425). The bubble's file rows are keyed by place, as the sent line names a file by its name and the transcript by its path.
- **One frame with the agent's read** (BTN-1361). A picture the user sent and the agent's read of it are one frame, so the pager counts pictures, not the places they show: a single-picture result whose file is in `.temp/inbox/` or known only by name (Claude's `image` line has the name, its tool line's `subject` the full path) is matched to the sent file by the full path where both know it, else by the name — a read of another worktree's inbox is another picture. The frame stands where it first shows, the user's bubble as a rule, and once the agent read it its address is the transcript's copy, which outlives the worktree's cleanup; until then the inbox address — either only where the browser holds no copy of it. The read's thumbnail opens the same frame, and a stack counts it once.

### The viewer

- **Every picture of the transcript.** `transcriptMedia` lists them in order, and a click opens `MediaViewer` on all of them, with its pager and Esc.
- **Names.** A picture is named by its file's name; pictures of one name from different folders (`npm run shot` puts each run into its own folder) are named by as many of their folders as tell each from the rest, `mock-a/1-chain.png` (`distinguish`, BTN-1685), while the same file and a bare name with no folder stay as they are.
- **The picture on view** is held by its key (`TranscriptMedia.keys`: a sent picture by its file's name from the send to the read, the rest by the call, a repeated name `#2`), not its place, so the list built again on delivery never puts a neighbour on view. The viewer closes by itself only when that picture left the chat, or on a handoff — not at a project chat's first session (BTN-1425).
- **dev:fake**: the transcript has a read of the past answer's `order.png`, two `Read` screenshots and a browser shot (`fakeShots`), and `?shots=many|gone` adds a group of 18 (`fakeManyShots`).

## Videos the user sent

BTN-1704: the pictures' path with one difference — the agent never reads a video, so its only copies are the browser's and the inbox file, and the inbox file goes with the worktree's cleanup.

- **The item.** `transcriptMedia` makes a sent `.mp4 .m4v .mov .webm .ogv` (`SENT_VIDEO`, `sentKind`, `isSentMedia`) an item of kind `video` in `byFile`: the browser's object URL when `useLocalPictures` holds it (it holds videos too, and wins at every stage as for pictures), else the service's `files/<name>` with `inbox: true`.
- **The thumbnail.** `SentFiles` draws it as `VideoThumb`: the first frame (`<video muted playsInline preload="metadata">`) with the chat field's ▶ (`.chat__play`, in `media.css`), "📎 name" until the service's copy has its metadata, a frame on screen kept under the next address (`.thumb__next`) and for good when that one fails, and the plain chip with no player when nothing was on screen and the file is gone. `InboxVideo` retries a missing inbox file as `InboxImage` does (`useRetried`).
- **Playing.** The press opens `MediaViewer` with the message's pictures, which already plays kind `video`; the mailbox's letters (`ChatMail`) draw files through the same `SentFiles`.
- **Ranges.** The service serves video types from the inbox only (`SHOWN_TYPES` in `src/sessions/inbox.ts`), and `sendFile` (`src/server-response.ts`) answers a single `Range` with 206, `content-range` and `accept-ranges: bytes` (416 past the end, several ranges — the whole file with 200), since Safari on iOS plays no `<video>` without it and Chrome cannot seek. A session on a machine sends the hub the whole file over the link (`fileOf`, `CarriedFile`) and the hub cuts the range from it, so each range request carries the whole file.

## Files a session sends

BTN-305. A `SendUserFile` call (`input.files`, `input.caption`) gets `FeedLine.share` in the whole fold — the caption, the files as named and the call's `cwd` (`shareOf`, `src/sessions/share.ts`, free of `node:*` since the page type-checks the fold).

- **The route.** `GET /api/sessions/<id>/shared/<tool>/<n>` resolves file `n` against that folder and gives it only inside the folder or its main checkout (`sharedFile`/`checkoutOf` in `src/sessions/shareFile.ts`: the part before `/.claude/worktrees/<name>`), since a session in a worktree writes to the main checkout's `.temp/` too; anything else, or a file that is gone, is a 404.
- **The card.** The share line breaks a group of calls and is a `ShareCard` (`web/src/pages/ShareCard.tsx`): the caption, a `.md` fetched and rendered in place (folded past 24 lines or 2000 characters), a picture as a thumbnail in the viewer's list (`TranscriptMedia.byShare`), anything else a download link.
- **A gone file** — the worktree is cleaned up — is its name crossed out and muted after a ⊘, with "The file is no longer there" and why in the tip (`Gone`, BTN-1377). The page does not keep a copy: once the folder is gone, so is the file.
- **dev:fake**: the chat of ABC-5 has a share of a markdown, a picture, an archive and a gone file (`fakeShare`).
