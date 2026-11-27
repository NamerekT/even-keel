# Accounts of the agents

The account folders of Claude Code, Codex, OpenCode and Copilot: adding them, signing in, keys, switching, how the page shows them and how the shared Claude configuration reaches each folder.

## Subtopics

The area is split by subtopic, a file each in `docs/accounts/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`folders.md`](accounts/folders.md) | Which folders there are, adding one, tokens and their renewal, the end of a sign-in, removal, the name of a folder across sign-ins, the macOS Keychain, the two sign-in links, OAuth token diagnostics, the active account |
| [`claude-kinds.md`](accounts/claude-kinds.md) | Keys of any agent (replacing a key, the key's organization, a key out of credit, a spending cap), Claude API accounts, long-token accounts, cloud accounts |
| [`other-agents.md`](accounts/other-agents.md) | The Codex, OpenCode and Copilot folders, one free ChatGPT account, OpenRouter |
| [`page.md`](accounts/page.md) | The drawer, the page, adding, the sign-in dialog, VS Code, subscription credits and extra usage, a machine's accounts, the Claude desktop app |
| [`share.md`](accounts/share.md) | Transferring the shared configuration (`src/account/share.ts`): what goes and when, the stores, edits made in an account folder and the hook guarding them, the folder's daemon |
