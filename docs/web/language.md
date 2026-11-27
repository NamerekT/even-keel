# Page: language and messages

The page language, the translation of server messages, and how a message a person reads is worded and shaped (BTN-57, `src/language.ts`: `en`, `ru`). Where each message stands is in its area: the project page's bands in `docs/web/project-page/notices.md`, toasts and the log in `docs/web/event-log.md`.

## Languages

- The `language` setting is the page language (`null` or no key — the browser language, English if it is unfamiliar), `promptLanguage` is the language of session prompts (absent — `language`, then English; `src/chain/prompts.ts`).
- The Russian page speaks to the user on «вы», the pronoun in lowercase («ждёт вас», never «Вы»); the CLI version option is «Своя», not «Твоя». Jokes and dialogues (`project.idle`, `home.memes`, `basement` in `ru.ts`) keep «ты»: a character's voice. A test in `web/src/i18n/i18n.test.ts` walks every Russian text, templates by their source and by a call with a stub, and allows «ты» only under those keys.
- The service log is in English; git and CLI output (`detail`) and strings saved before BTN-62 (the old `state/chain.json`) are shown as is. Data (transcripts, labels, tasks) is not translated.

## Translation of server messages (BTN-62)

The page translates its own chrome (`web/src/i18n/`, `ru.ts` is the source of the type, `en.ts` equals it) and server messages: pause reasons, cleanup, config, sign-in and command errors arrive as a code with values (`{ code, params, detail, cause, items }`, `src/notice/notice.ts`). The English text and the list of codes are in `src/notice/en.ts`, the Russian in `web/src/i18n/notices-ru.ts`, and the page builds the text with `say()`. A new code is an entry in both files; the type checks that the sets are equal.

## Errors in the page's words (BTN-297)

- A message a person reads names a setting by its label on the page, says what to do and, where the page has a place for it, gives a button there; paths of the config (`projects[0].branch`, `ABC.chain.active`) stay in the log and `config-import`. A test keeps paths out of them and out of the `wizard.*` texts.
- A setting refused at its field (an `ErrorStrip` under one field, `FieldNote` under a setting of several controls; `docs/design.md`, "Field strip") is said by `sayAtField`: the texts of `web/src/i18n/fields-en.ts`/`fields-ru.ts`, by the value; a code they lack falls back to `say()`. In `dev:fake` a project saved with an empty repository path is refused at that field (`config.repoEmpty`).

## Short messages (EKR-87)

- A message is one or two sentences — what happened and what to do. Its text, the labels over its commands and its buttons do not repeat each other: an instruction the text gives has no label over the command, or one word such as the shell.
- It shows one command, the one this installation needs; a second only when Even Keel cannot pick (a trust pause saved before it knew whether it runs as a service). A command reads by eye: no base64, no `-EncodedCommand`, no line quoted for two levels of process arguments; where `runas` needs that, Even Keel writes a short script into its state folder and the command runs the file (`state/trust/<task>.ps1`, `docs/sessions/agents.md`).
- The why — which user the service runs as, what a retry does — goes into a `?` tip or the log, not the text.
- **The length test.** `web/src/i18n/noticeLength.test.ts` measures every text of `src/notice/en.ts` (as the page shows it) and `web/src/i18n/notices-ru.ts`, each parameter counted as one character, against `NOTICE_LIMITS` (`web/src/i18n/noticeLength.ts`: 200 English, 220 Russian). A code's advice counts into its length, as `; advice`. `web/src/i18n/notice-lengths.json` held the texts longer than that when the rule came, where a length may only go down; it is empty and stays so: the test fails on a text past its limit, and `npm run notice-lengths` rewrites the file. A new code starts at the limit.
- **One advice per message** (BTN-1149): what to do about a code is kept apart from its text, in `ADVICE` (`src/notice/en-advice.ts`) and `adviceRu` (`web/src/i18n/notices-advice-ru.ts`, `t.advice`), and a chain of causes shows only the deepest notice's advice (`noticeAdvice`), so a wrapper's advice is for a cause without its own. `renderNotice` puts it at the end of the one line; `sayLines` (`noticeParts`) gives a toast and a band the head, and the causes with the advice as whole sentences under it. Every code that wraps a cause has its advice there; another moves its inline advice into `ADVICE` when its message is next touched, and one not there says it all in its text.
- **Paths** (BTN-1150): a path inside the project's or the task's folder is written from that folder. The notice carries the short one as `path` and the whole one as `full` (`ShownPath`, built by `shownUnder` of `src/paths.ts`); the page shows `path` with the whole one in a tip (`Said`, `SaidLines`: `fullPathsOf` walks the cause and the items), and `englishOf` puts `full` back, so the log and a thrown error name the whole path. A path elsewhere — the project's folder itself, the state folder, an account's file — stays whole and has no `full`.
- The title of a paused chain's toast is at most `TOAST_TITLE_LIMITS` (80 English, 90 Russian) after its subject, measured with values on sample entries by `web/src/layout/eventToast.test.ts`.

## The way to a fix (`web/src/pages/noticeFix.ts`, `FixButtons.tsx`)

`noticeFixOf` maps a notice — or the first of its items, then its cause — to the place that fixes it:

- a tab of the project's settings (`git.noBranch`, `chain.emptyLabels`, `prompt.empty`, `forward.foreign`, `chain.limitSpent`);
- Settings → Trackers and CI (`ci.noToken`, `ci.denied`, `review.denied`, `profiles.paused`);
- Settings → Interface (`builtin.fileTooLarge`);
- Settings → Sign-in and devices, where the owner key is (`config.token`, `config.tokenShape`);
- Accounts (`account.*`).

`NoticeFixButton` sits under the error of a card, of a project's page, of its carry and of its CI. The config banner opens the tab of the refused field (`fieldOf`, then `fieldFixOf`). A new code that a setting, a profile or an account fixes gets an entry in `BY_CODE`.
