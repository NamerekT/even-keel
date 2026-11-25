# Page: the session panel and the chat

Session account pills (`AccountTag`, `accountOf`) resolve a folder key first, then an e-mail within the session's agent when known. Every caller uses the session id to find its agent in the current session list; the chat can also take it directly from its target session. Without an agent, old records keep the first e-mail match. An e-mail belonging only to another agent leaves a neutral pill with the recorded address's name part. Stats and received-tools records use the same lookup; their own response formats carry no agent.

## Subtopics

The area is split by subtopic, a file each in `docs/web/session-panel/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`panel.md`](session-panel/panel.md) | A starting session, the session's facts, the chat with the current session, the chat's task panel, the window's frame |
| [`media.md`](session-panel/media.md) | Pictures in the transcript, files a session sends, calls in the chat |
| [`turn.md`](session-panel/turn.md) | The turn line, delivery, banners, the message menu, mail to a working session, commands, the live transcript window, `/api/session/answer` |
